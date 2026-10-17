'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/Button';
import { FieldError } from '@/components/FormValidation';
import styles from './PostAttachments.module.css';

export type PostMediaKind = 'image' | 'video';
export type PostMediaItem = { kind: PostMediaKind; url: string; altText?: string };
export type PostAttachmentDraftItem = PostMediaItem & {
  clientId: string;
  source: 'url' | 'upload';
  file?: File;
  error?: string;
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
  addLocalImage(file: File): void;
  addLocalImages(files: readonly File[]): void;
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
    setItems(current => current.map(item => item.clientId === clientId ? { ...item, ...change, error: undefined } : item));
    setError('');
  }, []);

  const add = useCallback((kind: PostMediaKind, source: 'url' | 'upload', file?: File) => {
    const current = itemsRef.current;
    if (current.length >= options.maxMedia) {
      setError(`Choose up to ${options.maxMedia} media attachments.`);
      return;
    }
    if (!options.allowedKinds.includes(kind)) {
      setError(`This post cannot include ${kind === 'image' ? 'images' : 'videos'} for the selected destinations.`);
      return;
    }
    if (!options.allowMixedKinds && current.some(item => item.kind !== kind)) {
      setError('Choose one media type for this post.');
      return;
    }
    const item: PostAttachmentDraftItem = {
      clientId: newId(), kind, source,
      url: '',
      ...(kind === 'image' ? { altText: '' } : {}),
      ...(file ? { file } : {}),
    };
    setItems(previous => [...previous, item]);
    itemsRef.current = [...current, item];
    setError('');
  }, [options.allowedKinds, options.allowMixedKinds, options.maxMedia]);

  const addLocalImages = useCallback((files: readonly File[]) => {
    if (!files.length) return;
    const current = itemsRef.current;
    if (current.length + files.length > options.maxMedia) {
      setError(`Choose up to ${options.maxMedia} media attachments. Remove an item or choose fewer images.`);
      return;
    }
    if (!options.allowedKinds.includes('image')) {
      setError('Images are not available for the selected destinations.');
      return;
    }
    if (options.allowedMimeTypes.length === 0) {
      setError('Local image uploads are unavailable for the selected destinations.');
      return;
    }
    if (!options.allowMixedKinds && current.some(item => item.kind !== 'image')) {
      setError('Choose one media type for this post.');
      return;
    }
    const additions = files.map(file => ({ clientId: newId(), kind: 'image' as const, source: 'upload' as const, url: '', altText: '', file }));
    const updated = [...current, ...additions];
    itemsRef.current = updated;
    setItems(updated);
    setError('');
  }, [options.allowedKinds, options.allowedMimeTypes, options.allowMixedKinds, options.maxMedia]);
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
    const current = itemsRef.current;
    if (current.length > options.maxMedia) {
      errors.set(current[options.maxMedia]?.clientId ?? current[0]?.clientId ?? '', `Choose up to ${options.maxMedia} media attachments.`);
    }
    for (const [index, item] of current.entries()) {
      if (!options.allowedKinds.includes(item.kind)) errors.set(item.clientId, `This media type is not available for the selected destinations.`);
      else if (!options.allowMixedKinds && current.some(other => other.kind !== item.kind)) errors.set(item.clientId, 'Choose one media type for this post.');
      else if (item.kind === 'image' && item.altText?.length && item.altText.length > options.maxAltCharacters) errors.set(item.clientId, `Image descriptions must be ${options.maxAltCharacters} characters or fewer.`);
      else if (item.file) {
        if (options.allowedMimeTypes.length === 0) errors.set(item.clientId, 'Local image uploads are unavailable for the selected destinations. Remove this file or choose another supported attachment.');
        else if (!options.allowedMimeTypes.includes(item.file.type) || item.file.size < 1 || item.file.size > options.maxUploadBytes) {
          errors.set(item.clientId, `Choose an allowed image up to ${Math.ceil(options.maxUploadBytes / 1048576)} MB.`);
        }
      } else if (item.source === 'upload') {
        if (!uploadedImageReference(item.url)) errors.set(item.clientId, 'Choose the image file again before saving.');
      } else if (!safeRemoteUrl(item.url)) {
        errors.set(item.clientId, 'Enter a complete HTTPS URL without a username or password.');
      }
      if (errors.has(item.clientId) && !firstInvalidId) firstInvalidId = item.clientId;
      if (index >= options.maxMedia && !firstInvalidId) firstInvalidId = item.clientId;
    }
    if (errors.size) {
      setItems(currentItems => currentItems.map(item => ({ ...item, error: errors.get(item.clientId) })));
      setError('Review the highlighted media attachments before saving.');
      if (firstInvalidId) {
        const firstInvalid = current.find(item => item.clientId === firstInvalidId)!;
        const targetId = errors.get(firstInvalidId)?.toLowerCase().includes('description')
          ? `${idPrefix}-media-alt-${firstInvalid.clientId}`
          : firstInvalid.source === 'upload' ? `${idPrefix}-media-item-${firstInvalid.clientId}` : `${idPrefix}-media-url-${firstInvalid.clientId}`;
        requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      }
      return false;
    }
    setItems(currentItems => currentItems.map(item => ({ ...item, error: undefined })));
    setError('');
    return true;
  }, [idPrefix, options.allowedKinds, options.allowMixedKinds, options.maxAltCharacters, options.maxMedia, options.allowedMimeTypes, options.maxUploadBytes]);

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
            ? { ...existing, error: 'Local image uploads are unavailable for the selected destinations. Remove this file or choose another supported attachment.' }
            : existing)));
          succeeded = false;
          continue;
        }
        if (!options.allowedMimeTypes.includes(item.file.type) || item.file.size < 1 || item.file.size > options.maxUploadBytes) {
          flushSync(() => setItems(current => current.map(existing => existing.clientId === item.clientId
            ? { ...existing, error: `Choose an allowed image up to ${Math.ceil(options.maxUploadBytes / 1048576)} MB.` }
            : existing)));
          succeeded = false;
          continue;
        }
        try {
          const body = new FormData();
          body.append('imageFile', item.file);
          const response = await fetch('/api/media', { method: 'POST', body });
          const result = await response.json().catch(() => ({})) as { reference?: unknown; error?: unknown };
          if (!response.ok || typeof result.reference !== 'string' || !uploadedImageReference(result.reference)) throw new Error('The image could not be uploaded. Try again.');
          flushSync(() => {
            setItems(current => {
              const updated = current.map(existing => existing.clientId === item.clientId
                ? { ...existing, url: result.reference as string, file: undefined, error: undefined }
                : existing);
              itemsRef.current = updated;
              return updated;
            });
          });
        } catch {
          succeeded = false;
          flushSync(() => setItems(current => current.map(existing => existing.clientId === item.clientId
            ? { ...existing, error: 'The image could not be uploaded. Try again.' }
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
      flushSync(() => setItems(currentItems => currentItems.map(item => ({ ...item, error: undefined }))));
      return true;
    } finally {
      busy.current = false;
      flushSync(() => setUploading(false));
    }
  }, [idPrefix, options.allowedMimeTypes, options.maxUploadBytes, validate]);

  return {
    idPrefix, items, media, mediaJson, uploading, error,
    allowedKinds: options.allowedKinds, allowedMimeTypes: options.allowedMimeTypes,
    maxAltCharacters: options.maxAltCharacters, maxMedia: options.maxMedia, setError,
    addRemote: kind => add(kind, 'url'),
    addLocalImage, addLocalImages,
    updateItem: update, removeItem, reorder, validate, prepareUploads,
  };
}

export function PostAttachments({ controller, disabled = false }: { controller: PostAttachmentsController; disabled?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const canAddImages = controller.allowedKinds.includes('image');
  const canUploadLocalImages = canAddImages && controller.allowedMimeTypes.length > 0;
  const canAddVideos = controller.allowedKinds.includes('video');
  const atLimit = controller.items.length >= controller.maxMedia;
  const move = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= controller.items.length) return;
    controller.reorder(index, destination);
  };

  return <section className={styles.attachments} aria-labelledby={`${controller.idPrefix}-title`}>
    <h3 id={`${controller.idPrefix}-title`}>Media attachments <span>(optional)</span></h3>
    {canUploadLocalImages && <input
      ref={fileInput}
      className={styles.filePicker}
      type="file"
      id={`${controller.idPrefix}-local-image`}
      multiple
      accept={controller.allowedMimeTypes.join(',')}
      data-testid="local-image-input"
      aria-label="Choose a local image"
      disabled={disabled || controller.uploading}
      onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        if (files.length) controller.addLocalImages(files);
        event.currentTarget.value = '';
      }}
    />}
    {controller.maxMedia > 0 && (canAddImages || canAddVideos) && <div className={styles.addControls}>
      {canAddImages && <Button size="sm" disabled={disabled || controller.uploading || atLimit} onClick={() => controller.addRemote('image')}>Add image URL</Button>}
      {canAddVideos && <Button size="sm" disabled={disabled || controller.uploading || atLimit} onClick={() => controller.addRemote('video')}>Add video URL</Button>}
      {canUploadLocalImages && <Button size="sm" disabled={disabled || controller.uploading || atLimit} onClick={() => fileInput.current?.click()}>Add local images</Button>}
    </div>}
    {controller.maxMedia === 0 ? <p className={styles.empty}>Media attachments are unavailable for this workspace.</p>
      : atLimit ? <p className={styles.empty}>{controller.items.length} of {controller.maxMedia} media attachments are used. Remove an attachment before adding another.</p>
      : controller.allowedKinds.length === 0 && <p className={styles.empty}>Choose destinations that support images or videos to add media. Your draft can still be saved.</p>}
    {controller.error && <FieldError id={`${controller.idPrefix}-global-error`}>{controller.error}</FieldError>}
    <input type="hidden" name="mediaJson" value={controller.mediaJson} readOnly />
    {controller.items.length === 0 ? <p className={styles.empty}>No media attachments added.</p> : <ol className={styles.list}>
      {controller.items.map((item, index) => <li className={styles.item} key={item.clientId} id={`${controller.idPrefix}-media-item-${item.clientId}`} tabIndex={item.error && item.source === 'upload' ? -1 : undefined} aria-describedby={item.error && item.source === 'upload' ? `${controller.idPrefix}-media-error-${item.clientId}` : undefined}>
        <div className={styles.itemHeading}><strong>{item.kind === 'image' ? 'Image' : 'Video'} {index + 1}</strong>{item.file && <span>{item.file.name}</span>}</div>
        {item.source === 'url' ? <label className="ui-field">
          <span>{item.kind === 'image' ? 'Image URL' : 'Video URL'} attachment {index + 1}</span>
          <input className="ui-input" id={`${controller.idPrefix}-media-url-${item.clientId}`} name={`mediaUrl-${item.clientId}`} type="url" disabled={disabled || controller.uploading} value={item.url.startsWith('media:') ? `/api/media/${item.url.slice('media:'.length)}` : item.url} onChange={event => {
            const value = event.currentTarget.value;
            const mediaPrefix = '/api/media/';
            const stored = value.startsWith(mediaPrefix) ? `media:${value.slice(mediaPrefix.length)}` : value;
            controller.updateItem(item.clientId, { url: stored });
          }} aria-invalid={item.error ? true : undefined} aria-describedby={item.error ? `${controller.idPrefix}-media-error-${item.clientId}` : undefined} />
        </label> : <div className={styles.localStatus}>{item.file ? 'Local image ready to upload' : 'Saved workspace image'}</div>}
        {item.kind === 'image' && <label className="ui-field">
          <span>Image description attachment {index + 1} <span>(optional)</span></span>
          <input className="ui-input" id={`${controller.idPrefix}-media-alt-${item.clientId}`} name={`mediaAlt-${item.clientId}`} type="text" disabled={disabled || controller.uploading} maxLength={controller.maxAltCharacters} value={item.altText ?? ''} onChange={event => controller.updateItem(item.clientId, { altText: event.currentTarget.value })} aria-invalid={item.error && /description/i.test(item.error) ? true : undefined} aria-describedby={item.error && /description/i.test(item.error) ? `${controller.idPrefix}-media-error-${item.clientId}` : undefined} />
        </label>}
        {item.error && <FieldError id={`${controller.idPrefix}-media-error-${item.clientId}`}>{item.error}</FieldError>}
        <div className={styles.itemActions}>
          <Button size="sm" variant="quiet" aria-label={`Move attachment ${index + 1} up`} disabled={disabled || controller.uploading || index === 0} onClick={() => move(index, -1)}>Move up</Button>
          <Button size="sm" variant="quiet" aria-label={`Move attachment ${index + 1} down`} disabled={disabled || controller.uploading || index === controller.items.length - 1} onClick={() => move(index, 1)}>Move down</Button>
          <Button size="sm" variant="quiet" aria-label={`Remove attachment ${index + 1}`} disabled={disabled || controller.uploading} onClick={() => controller.removeItem(item.clientId)}>Remove</Button>
        </div>
      </li>)}
    </ol>}
    {controller.uploading && <p className={styles.uploadStatus} role="status">Uploading images…</p>}
  </section>;
}

export function AuthoringMediaPreview({ controller }: { controller: PostAttachmentsController }) {
  const [objectUrls, setObjectUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const urls = Object.fromEntries(controller.items.filter(item => item.file).map(item => [item.clientId, URL.createObjectURL(item.file!)]));
    setObjectUrls(urls);
    return () => Object.values(urls).forEach(url => URL.revokeObjectURL(url));
  }, [controller.items]);
  if (!controller.items.length) return null;
  return <ol className={styles.previewList} aria-label="Attachment preview">
    {controller.items.map((item, index) => {
      const localId = item.url.startsWith('media:') ? item.url.slice('media:'.length) : '';
      const src = item.file ? objectUrls[item.clientId] : localId ? (MEDIA_ID.test(localId) ? `/api/media/${encodeURIComponent(localId)}` : '') : safeRemoteUrl(item.url) ? item.url : '';
      return <li key={item.clientId}>
        <span>{index + 1}. {item.kind === 'image' ? 'Image' : 'Video'}</span>
        {item.kind === 'image' && src ? <img src={src} alt={item.altText?.trim() || 'Selected post image'} /> : null}
        {item.kind === 'video' && src ? <video controls preload="metadata" src={src} aria-label={`Video attachment ${index + 1}`} /> : null}
        {item.kind === 'image' && item.altText?.trim() && <small>{item.altText}</small>}
      </li>;
    })}
  </ol>;
}
