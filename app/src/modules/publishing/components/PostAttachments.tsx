'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { IconLink, IconPhoto, IconUpload } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { useContent } from '../ui/ContentProvider';
import { FieldError } from '@/components/FormValidation';
import styles from './PostAttachments.module.css';
import { useAttachmentCopy } from '../ui/compose/CopyProvider';
import { fillComposerCopy } from '../composer-catalog';
import { AltTextSuggest } from '@/modules/studio/components/AltTextSuggest';

export type PostMediaKind = 'image' | 'video';
export type PostMediaItem = { kind: PostMediaKind; url: string; altText?: string };
export type PostAttachmentDraftItem = PostMediaItem & {
  clientId: string;
  source: 'url' | 'upload';
  file?: File;
  /** Client-only signed preview from the upload receipt; never serialized into the saved media list. */
  previewUrl?: string;
  error?: string;
  errorField?: 'alt' | 'attachment';
  /** Link items only: the type follows what the link turns out to be until the person picks one. */
  autoKind?: boolean;
  detect?: 'pending' | 'image' | 'video' | 'unknown';
};

export type PostAttachmentOptions = {
  initialMedia?: readonly PostMediaItem[];
  allowedKinds: readonly PostMediaKind[];
  maxMedia: number;
  maxAltCharacters: number;
  allowedMimeTypes: readonly string[];
  maxUploadBytes: number;
  allowMixedKinds?: boolean;
};

export type PostAttachmentsController = {
  idPrefix: string;
  items: readonly PostAttachmentDraftItem[];
  media: PostMediaItem[];
  mediaJson: string;
  uploading: boolean;
  error: string;
  allowedKinds: readonly PostMediaKind[];
  allowedMimeTypes: readonly string[];
  maxAltCharacters: number;
  maxMedia: number;
  setError(message: string): void;
  addRemote(kind: PostMediaKind): void;
  /** Adds one media link whose image/video type is detected from the link itself. */
  addLink(): void;
  addLocalImage(file: File): void;
  addLocalImages(files: readonly File[]): void;
  /** Adds images that already live in the workspace library (by id), skipping duplicates and anything over the limit. */
  addLibraryImages(ids: readonly string[]): void;
  updateItem(clientId: string, change: Partial<PostAttachmentDraftItem>): void;
  removeItem(clientId: string): void;
  reorder(from: number, to: number): void;
  validate(): boolean;
  prepareUploads(): Promise<boolean>;
};

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let nextItemId = 0;

function newId() {
  return `attachment-${++nextItemId}`;
}

function fromSaved(media: readonly PostMediaItem[] = []): PostAttachmentDraftItem[] {
  return media.map((item, index) => ({
    ...item,
    clientId: `saved-${index}`,
    source: item.kind === 'image' && item.url.startsWith('media:') ? 'upload' : 'url',
  }));
}

function serializeItems(items: readonly PostAttachmentDraftItem[]): PostMediaItem[] {
  return items.filter(item => item.url.trim()).map(item => ({
    kind: item.kind,
    url: item.url.trim(),
    ...(item.kind === 'image' && item.altText?.trim() ? { altText: item.altText.trim() } : {}),
  }));
}

function safeRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function uploadedImageReference(value: string): boolean {
  const id = /^media:(.+)$/i.exec(value)?.[1] ?? '';
  return MEDIA_ID.test(id);
}

export function usePostAttachments(options: PostAttachmentOptions): PostAttachmentsController {
  const c = useAttachmentCopy();
  const idPrefix = `post-attachments-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [items, setItems] = useState<PostAttachmentDraftItem[]>(() => fromSaved(options.initialMedia));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const media = useMemo(() => serializeItems(items), [items]);
  const mediaJson = useMemo(() => JSON.stringify(media), [media]);

  const update = useCallback((clientId: string, change: Partial<PostAttachmentDraftItem>) => {
    setItems(current => current.map(item => item.clientId === clientId ? { ...item, ...change, error: undefined, errorField: undefined } : item));
    setError('');
  }, []);

  const add = useCallback((kind: PostMediaKind, source: 'url' | 'upload', file?: File, auto = false) => {
    const current = itemsRef.current;
    if (current.length >= options.maxMedia) {
      setError(fillComposerCopy(c.limit, { max: options.maxMedia }));
      return;
    }
    if (!options.allowedKinds.includes(kind)) {
      setError(fillComposerCopy(c.kindDenied, { kind: kind === 'image' ? c.images : c.videos }));
      return;
    }
    if (!options.allowMixedKinds && current.some(item => item.kind !== kind)) {
      setError(c.oneType);
      return;
    }
    const item: PostAttachmentDraftItem = {
      clientId: newId(), kind, source,
      url: '',
      ...(kind === 'image' ? { altText: '' } : {}),
      ...(file ? { file } : {}),
      ...(auto ? { autoKind: true, detect: 'pending' as const } : {}),
    };
    setItems(previous => [...previous, item]);
    itemsRef.current = [...current, item];
    setError('');
  }, [options.allowedKinds, options.allowMixedKinds, options.maxMedia, c]);

  const addLibraryImages = useCallback((ids: readonly string[]) => {
    const current = itemsRef.current;
    if (!options.allowedKinds.includes('image')) { setError(fillComposerCopy(c.kindDenied, { kind: c.images })); return; }
    if (!options.allowMixedKinds && current.some(item => item.kind !== 'image')) { setError(c.oneType); return; }
    const room = Math.max(0, options.maxMedia - current.length);
    if (!room) { setError(fillComposerCopy(c.limit, { max: options.maxMedia })); return; }
    const added: PostAttachmentDraftItem[] = [...new Set(ids)].filter(id => MEDIA_ID.test(id) && !current.some(item => item.url === `media:${id}`)).slice(0, room)
      .map(id => ({ clientId: newId(), kind: 'image' as const, source: 'upload' as const, url: `media:${id}`, altText: '' }));
    if (!added.length) return;
    itemsRef.current = [...current, ...added];
    setItems(previous => [...previous, ...added]);
    setError('');
  }, [options.allowedKinds, options.allowMixedKinds, options.maxMedia, c]);

  const addLink = useCallback(() => {
    const first = itemsRef.current[0];
    const guess = !options.allowMixedKinds && first ? first.kind : options.allowedKinds.includes('image') ? 'image' : options.allowedKinds[0] ?? 'image';
    add(guess, 'url', undefined, true);
  }, [add, options.allowMixedKinds, options.allowedKinds]);

  const addLocalImages = useCallback((files: readonly File[]) => {
    if (!files.length) return;
    const current = itemsRef.current;
    if (current.length + files.length > options.maxMedia) {
      setError(fillComposerCopy(c.limitMany, { max: options.maxMedia }));
      return;
    }
    if (!options.allowedKinds.includes('image')) {
      setError(c.imagesUnavailable);
      return;
    }
    if (options.allowedMimeTypes.length === 0) {
      setError(c.uploadsUnavailable);
      return;
    }
    if (!options.allowMixedKinds && current.some(item => item.kind !== 'image')) {
      setError(c.oneType);
      return;
    }
    const additions = files.map(file => ({ clientId: newId(), kind: 'image' as const, source: 'upload' as const, url: '', altText: '', file }));
    const updated = [...current, ...additions];
    itemsRef.current = updated;
    setItems(updated);
    setError('');
  }, [options.allowedKinds, options.allowedMimeTypes, options.allowMixedKinds, options.maxMedia, c]);
  const addLocalImage = useCallback((file: File) => addLocalImages([file]), [addLocalImages]);

  const removeItem = useCallback((clientId: string) => {
    setItems(current => {
      const updated = current.filter(item => item.clientId !== clientId);
      itemsRef.current = updated;
      return updated;
    });
    setError('');
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setItems(current => {
      if (from < 0 || from >= current.length || to < 0 || to >= current.length) return current;
      const updated = [...current];
      const [item] = updated.splice(from, 1);
      if (item) updated.splice(to, 0, item);
      itemsRef.current = updated;
      return updated;
    });
    setError('');
  }, []);

  const validate = useCallback(() => {
    let firstInvalidId: string | undefined;
    const errors = new Map<string, string>();
    const altErrors = new Set<string>();
    const current = itemsRef.current;
    if (current.length > options.maxMedia) {
      errors.set(current[options.maxMedia]?.clientId ?? current[0]?.clientId ?? '', fillComposerCopy(c.limit, { max: options.maxMedia }));
    }
    for (const [index, item] of current.entries()) {
      if (!options.allowedKinds.includes(item.kind)) errors.set(item.clientId, c.kindUnavailable);
      else if (!options.allowMixedKinds && current.some(other => other.kind !== item.kind)) errors.set(item.clientId, c.oneType);
      else if (item.kind === 'image' && item.altText?.length && item.altText.length > options.maxAltCharacters) { errors.set(item.clientId, fillComposerCopy(c.descriptionMax, { max: options.maxAltCharacters })); altErrors.add(item.clientId); }
      else if (item.file) {
        if (options.allowedMimeTypes.length === 0) errors.set(item.clientId, c.uploadsUnsupported);
        else if (!options.allowedMimeTypes.includes(item.file.type) || item.file.size < 1 || item.file.size > options.maxUploadBytes) {
          errors.set(item.clientId, fillComposerCopy(c.uploadSize, { max: Math.ceil(options.maxUploadBytes / 1048576) }));
        }
      } else if (item.source === 'upload') {
        if (!uploadedImageReference(item.url)) errors.set(item.clientId, c.chooseAgain);
      } else if (!safeRemoteUrl(item.url)) {
        errors.set(item.clientId, c.invalidUrl);
      }
      if (errors.has(item.clientId) && !firstInvalidId) firstInvalidId = item.clientId;
      if (index >= options.maxMedia && !firstInvalidId) firstInvalidId = item.clientId;
    }
    if (errors.size) {
      setItems(currentItems => currentItems.map(item => ({ ...item, error: errors.get(item.clientId), errorField: errors.has(item.clientId) ? (altErrors.has(item.clientId) ? 'alt' as const : 'attachment' as const) : undefined })));
      setError(c.review);
      if (firstInvalidId) {
        const firstInvalid = current.find(item => item.clientId === firstInvalidId)!;
        const targetId = altErrors.has(firstInvalid.clientId)
          ? `${idPrefix}-media-alt-${firstInvalid.clientId}`
          : firstInvalid.source === 'upload' ? `${idPrefix}-media-item-${firstInvalid.clientId}` : `${idPrefix}-media-url-${firstInvalid.clientId}`;
        requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      }
      return false;
    }
    setItems(currentItems => currentItems.map(item => ({ ...item, error: undefined, errorField: undefined })));
    setError('');
    return true;
  }, [idPrefix, options.allowedKinds, options.allowMixedKinds, options.maxAltCharacters, options.maxMedia, options.allowedMimeTypes, options.maxUploadBytes, c]);

  const prepareUploads = useCallback(async () => {
    if (busy.current) return false;
    busy.current = true;
    setUploading(true);
    setError('');
    let succeeded = true;
    try {
      // Use the current complete list. Successful references are committed after each
      // request, so a later failure can be retried without uploading confirmed files again.
      for (const item of itemsRef.current) {
        if (!item.file) continue;
        if (options.allowedMimeTypes.length === 0) {
          flushSync(() => setItems(current => current.map(existing => existing.clientId === item.clientId
            ? { ...existing, error: c.uploadsUnsupported }
            : existing)));
          succeeded = false;
          continue;
        }
        if (!options.allowedMimeTypes.includes(item.file.type) || item.file.size < 1 || item.file.size > options.maxUploadBytes) {
          flushSync(() => setItems(current => current.map(existing => existing.clientId === item.clientId
            ? { ...existing, error: fillComposerCopy(c.uploadSize, { max: Math.ceil(options.maxUploadBytes / 1048576) }) }
            : existing)));
          succeeded = false;
          continue;
        }
        try {
          const body = new FormData();
          body.append('imageFile', item.file);
          const response = await fetch('/api/media', { method: 'POST', body });
          const result = await response.json().catch(() => ({})) as { reference?: unknown; signedUrl?: unknown; error?: unknown };
          if (!response.ok || typeof result.reference !== 'string' || !uploadedImageReference(result.reference)) throw new Error(c.uploadFailed);
          const previewUrl = typeof result.signedUrl === 'string' && result.signedUrl.startsWith('/api/media/') ? result.signedUrl : undefined;
          flushSync(() => {
            setItems(current => {
              const updated = current.map(existing => existing.clientId === item.clientId
                ? { ...existing, url: result.reference as string, file: undefined, ...(previewUrl ? { previewUrl } : {}), error: undefined, errorField: undefined }
                : existing);
              itemsRef.current = updated;
              return updated;
            });
          });
        } catch {
          succeeded = false;
          flushSync(() => setItems(current => current.map(existing => existing.clientId === item.clientId
            ? { ...existing, error: c.uploadFailed }
            : existing)));
        }
      }
      const current = itemsRef.current;
      const pendingFiles = current.some(item => item.file);
      const valid = succeeded && !pendingFiles && validate();
      if (!valid) {
        if (!succeeded || pendingFiles) {
          const firstFailed = current.find(item => item.error);
          if (firstFailed) {
            const targetId = `${idPrefix}-media-item-${firstFailed.clientId}`;
            requestAnimationFrame(() => {
              const target = document.getElementById(targetId);
              if (target?.isConnected) target.focus();
            });
          }
        }
        return false;
      }
      // Flush validation and confirmed references before the caller resubmits its form.
      flushSync(() => setItems(currentItems => currentItems.map(item => ({ ...item, error: undefined, errorField: undefined }))));
      return true;
    } finally {
      busy.current = false;
      flushSync(() => setUploading(false));
    }
  }, [idPrefix, options.allowedMimeTypes, options.maxUploadBytes, validate, c]);

  return {
    idPrefix, items, media, mediaJson, uploading, error,
    allowedKinds: options.allowedKinds, allowedMimeTypes: options.allowedMimeTypes,
    maxAltCharacters: options.maxAltCharacters, maxMedia: options.maxMedia, setError,
    addRemote: kind => add(kind, 'url'),
    addLink,
    addLocalImage, addLocalImages, addLibraryImages,
    updateItem: update, removeItem, reorder, validate, prepareUploads,
  };
}

export function PostAttachments({ controller, disabled = false, onPickLibrary, altTextAssist }: { controller: PostAttachmentsController; disabled?: boolean; /** Offer AI image descriptions for stored images (set only when the server reports it available). */ altTextAssist?: { locale: 'en' | 'fr' }; /** Opens the caller's library picker; the "From library" button shows only when given. */ onPickLibrary?: () => void }) {
  const c = useAttachmentCopy();
  const content = useContent().copy;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // A link is only tried once it is pasted or the field is left, not on every keystroke.
  const [committed, setCommitted] = useState<Record<string, string>>({});
  const commit = (clientId: string, value: string) => setCommitted(current => current[clientId] === value.trim() ? current : { ...current, [clientId]: value.trim() });
  const canAddImages = controller.allowedKinds.includes('image');
  const canUploadLocalImages = canAddImages && controller.allowedMimeTypes.length > 0;
  const canAddVideos = controller.allowedKinds.includes('video');
  const atLimit = controller.items.length >= controller.maxMedia;
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= controller.items.length) return;
    controller.reorder(index, destination);
  };

  const canDrop = canUploadLocalImages && !disabled && !controller.uploading && !atLimit;
  return <section className={`${styles.attachments}${dragging ? ` ${styles.dragging}` : ''}`} aria-labelledby={`${controller.idPrefix}-title`}
    onDragOver={event => { if (canDrop && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { setDragging(false); if (!canDrop) return; event.preventDefault(); const files = Array.from(event.dataTransfer.files); if (files.length) controller.addLocalImages(files); }}>
    <h3 id={`${controller.idPrefix}-title`} className="ui-visually-hidden">{c.heading}</h3>
    {controller.maxMedia > 0 && (canAddImages || canAddVideos) && <div className={styles.dropHint} aria-hidden="true"><IconPhoto size={22} stroke={1.6} /><span>{dragging ? content.createDropActive : content.createDrop}</span></div>}
    {canUploadLocalImages && <input
      ref={fileInput}
      className={styles.filePicker}
      type="file"
      id={`${controller.idPrefix}-local-image`}
      multiple
      accept={controller.allowedMimeTypes.join(',')}
      data-testid="local-image-input"
      aria-label={c.chooseImage}
      disabled={disabled || controller.uploading}
      onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        if (files.length) controller.addLocalImages(files);
        event.currentTarget.value = '';
      }}
    />}
    {controller.maxMedia > 0 && (canAddImages || canAddVideos) && <div className={styles.addControls}>
      {canUploadLocalImages && <Button size="sm" leading={<IconUpload size={15} aria-hidden="true" />} disabled={disabled || controller.uploading || atLimit} onClick={() => fileInput.current?.click()}>{content.createUpload}</Button>}
      {canAddImages && onPickLibrary && <Button size="sm" leading={<IconPhoto size={15} aria-hidden="true" />} disabled={disabled || controller.uploading || atLimit} onClick={onPickLibrary}>{content.createFromLibrary}</Button>}
      <Button size="sm" leading={<IconLink size={15} aria-hidden="true" />} disabled={disabled || controller.uploading || atLimit} onClick={() => controller.addLink()}>{c.addLink}</Button>
    </div>}
    {controller.maxMedia === 0 ? <p className={styles.empty}>{c.unavailable}</p>
      : atLimit ? <p className={styles.empty}>{fillComposerCopy(c.used, { used: controller.items.length, max: controller.maxMedia })}</p>
      : controller.allowedKinds.length === 0 && <p className={styles.empty}>{c.chooseDestinations}</p>}
    {controller.error && <FieldError id={`${controller.idPrefix}-global-error`}>{controller.error}</FieldError>}
    <input type="hidden" name="mediaJson" value={controller.mediaJson} readOnly />
    {controller.items.length === 0 ? <p className={styles.empty}>{c.empty}</p> : <ol className={styles.list}>
      {controller.items.map((item, index) => <li className={styles.item} key={item.clientId} id={`${controller.idPrefix}-media-item-${item.clientId}`} tabIndex={item.error && item.source === 'upload' ? -1 : undefined} aria-describedby={item.error && item.source === 'upload' ? `${controller.idPrefix}-media-error-${item.clientId}` : undefined}>
        <div className={styles.itemHeading}>
          <div style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span className={styles.ordinalBadge}>{index + 1}</span>
            <strong>{item.kind === 'image' ? c.image : c.video}</strong>
            <span className={styles.aspectBadge}>{item.kind === 'video' ? '16:9 / 9:16' : 'Aspect Guard: OK'}</span>
          </div>
          {item.file && <span>{item.file.name}</span>}
        </div>
        {item.source === 'url' ? <>
          <label className="ui-field">
            <span>{fillComposerCopy(c.linkLabel, { n: index + 1 })}</span>
            <input className="ui-input" id={`${controller.idPrefix}-media-url-${item.clientId}`} name={`mediaUrl-${item.clientId}`} type="url" disabled={disabled || controller.uploading} value={item.url.startsWith('media:') ? `/api/media/${item.url.slice('media:'.length)}` : item.url} onChange={event => {
              const value = event.currentTarget.value;
              const mediaPrefix = '/api/media/';
              const stored = value.startsWith(mediaPrefix) ? `media:${value.slice(mediaPrefix.length)}` : value;
              controller.updateItem(item.clientId, { url: stored, ...(item.autoKind ? { detect: 'pending' as const } : {}) });
            }} onBlur={event => commit(item.clientId, event.currentTarget.value)} onPaste={event => { const input = event.currentTarget; setTimeout(() => commit(item.clientId, input.value), 0); }} aria-invalid={item.error ? true : undefined} aria-describedby={item.error ? `${controller.idPrefix}-media-error-${item.clientId}` : undefined} />
          </label>
          <MediaLinkDetector item={item} controller={controller} disabled={disabled || controller.uploading} committed={committed[item.clientId] ?? ''} />
        </> : <div className={styles.localStatus}>{item.file ? c.ready : c.saved}</div>}
        {item.kind === 'image' && <label className="ui-field">
          <span>{fillComposerCopy(c.descriptionLabel, { n: index + 1 })} <span>{c.optional}</span></span>
          <input className="ui-input" id={`${controller.idPrefix}-media-alt-${item.clientId}`} name={`mediaAlt-${item.clientId}`} type="text" disabled={disabled || controller.uploading} maxLength={controller.maxAltCharacters} value={item.altText ?? ''} onChange={event => controller.updateItem(item.clientId, { altText: event.currentTarget.value })} aria-invalid={item.error && item.errorField === 'alt' ? true : undefined} aria-describedby={item.error && item.errorField === 'alt' ? `${controller.idPrefix}-media-error-${item.clientId}` : undefined} />
        </label>}
        {item.kind === 'image' && altTextAssist && item.url.startsWith('media:') && <AltTextSuggest imageId={item.url.slice('media:'.length)} locale={altTextAssist.locale} disabled={disabled || controller.uploading} onSuggestion={text => controller.updateItem(item.clientId, { altText: text.slice(0, controller.maxAltCharacters) })} />}
        {item.error && <FieldError id={`${controller.idPrefix}-media-error-${item.clientId}`}>{item.error}</FieldError>}
        <div className={styles.itemActions}>
          <Button size="sm" variant="quiet" aria-label={fillComposerCopy(c.moveUpLabel, { n: index + 1 })} disabled={disabled || controller.uploading || index === 0} onClick={() => move(index, -1)}>{c.moveUp}</Button>
          <Button size="sm" variant="quiet" aria-label={fillComposerCopy(c.moveDownLabel, { n: index + 1 })} disabled={disabled || controller.uploading || index === controller.items.length - 1} onClick={() => move(index, 1)}>{c.moveDown}</Button>
          <Button size="sm" variant="quiet" aria-label={fillComposerCopy(c.removeLabel, { n: index + 1 })} disabled={disabled || controller.uploading} onClick={() => controller.removeItem(item.clientId)}>{c.remove}</Button>
        </div>
      </li>)}
    </ol>}
    {controller.uploading && <p className={styles.uploadStatus} role="status">{c.uploading}</p>}
  </section>;
}

/**
 * Settles whether a link is an image or a video by letting the browser load it
 * (image first, then video), shows what loaded as the preview, and lets the person
 * correct the type. The server still inspects the real bytes at import.
 */
function MediaLinkDetector({ item, controller, disabled, committed }: { item: PostAttachmentDraftItem; controller: PostAttachmentsController; disabled: boolean; committed: string }) {
  const c = useAttachmentCopy();
  const probable = Boolean(item.autoKind) && committed === item.url.trim() && safeRemoteUrl(committed);
  const [probe, setProbe] = useState<'image' | 'video'>('image');
  const url = item.url.trim();
  const { updateItem, allowedKinds } = controller;
  useEffect(() => setProbe(item.kind), [url]); // eslint-disable-line react-hooks/exhaustive-deps
  const settle = useCallback((kind: 'image' | 'video') => {
    if (!item.autoKind || !allowedKinds.includes(kind)) { if (item.autoKind) updateItem(item.clientId, { detect: kind }); return; }
    updateItem(item.clientId, { kind, detect: kind, ...(kind === 'image' ? { altText: item.altText ?? '' } : {}) });
  }, [item.autoKind, item.clientId, item.altText, allowedKinds, updateItem]);
  const failed = () => {
    if (probe === 'image') setProbe('video');
    else if (item.autoKind) updateItem(item.clientId, { detect: 'unknown' });
  };
  const status = !item.autoKind ? '' : item.detect === 'unknown' ? c.detectUnknown : item.detect === 'pending' ? (probable ? c.detecting : '') : item.detect === 'image' ? c.detectedImage : item.detect === 'video' ? c.detectedVideo : '';
  return <div className={styles.linkDetector}>
    {probable && (probe === 'image'
      ? <img key={`i-${url}`} className={styles.linkPreview} src={url} alt="" onLoad={() => settle('image')} onError={failed} />
      : <video key={`v-${url}`} className={styles.linkPreview} muted preload="metadata" src={url} onLoadedMetadata={() => settle('video')} onError={failed} />)}
    <label className="ui-field">
      <span>{c.typeLabel}</span>
      <select className="ui-input" disabled={disabled} value={item.kind} onChange={event => controller.updateItem(item.clientId, { kind: event.currentTarget.value as PostMediaKind, autoKind: false, detect: undefined })}>
        {controller.allowedKinds.map(kind => <option key={kind} value={kind}>{kind === 'image' ? c.image : c.video}</option>)}
      </select>
    </label>
    {status && <p className={styles.localStatus} role="status">{status}</p>}
  </div>;
}

export function AuthoringMediaPreview({ controller, layout, aspect }: { controller: PostAttachmentsController; layout?: 'list' | 'tiles'; aspect?: 'landscape' | 'square' | 'portrait' | 'story' | null }) {
  const c = useAttachmentCopy();
  const [objectUrls, setObjectUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const urls = Object.fromEntries(controller.items.filter(item => item.file).map(item => [item.clientId, URL.createObjectURL(item.file!)]));
    setObjectUrls(urls);
    return () => Object.values(urls).forEach(url => URL.revokeObjectURL(url));
  }, [controller.items]);
  if (!controller.items.length) return null;
  const sources = controller.items.map(item => {
    const localId = item.url.startsWith('media:') ? item.url.slice('media:'.length) : '';
    const signedPreview = item.previewUrl?.startsWith('/api/media/') ? item.previewUrl : undefined;
    return item.file ? objectUrls[item.clientId] : localId ? (signedPreview ?? (MEDIA_ID.test(localId) ? `/api/media/${encodeURIComponent(localId)}` : '')) : safeRemoteUrl(item.url) ? item.url : '';
  });
  // Channel layout: the same items as tiles in the channel's shape, without the authoring numbers.
  if (layout === 'tiles') return <div className={styles.channelTiles} data-aspect={aspect ?? undefined} role="group" aria-label={c.preview}>
    {controller.items.map((item, index) => {
      const src = sources[index];
      return <div key={item.clientId} className={styles.channelTile}>
        {item.kind === 'image' && src ? <img src={src} alt={item.altText?.trim() || c.selectedImage} /> : null}
        {item.kind === 'video' && src ? <video controls preload="metadata" src={src} aria-label={fillComposerCopy(c.videoLabel, { n: index + 1 })} /> : null}
      </div>;
    })}
  </div>;
  return <ol className={styles.previewList} aria-label={c.preview}>
    {controller.items.map((item, index) => {
      const src = sources[index];
      return <li key={item.clientId}>
        <span>{index + 1}. {item.kind === 'image' ? c.image : c.video}</span>
        {item.kind === 'image' && src ? <img src={src} alt={item.altText?.trim() || c.selectedImage} /> : null}
        {item.kind === 'video' && src ? <video controls preload="metadata" src={src} aria-label={fillComposerCopy(c.videoLabel, { n: index + 1 })} /> : null}
        {item.kind === 'image' && item.altText?.trim() && <small>{item.altText}</small>}
      </li>;
    })}
  </ol>;
}
