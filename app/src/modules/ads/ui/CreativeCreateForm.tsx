'use client';
import { useAdsMessage } from '@/modules/ads/ui/AdsCopyProvider';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { AutoTextarea } from '@/components/AutoTextarea';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { useConfirm } from '@/components/useConfirm';
import type { AdsNeutralOperation } from '../management/types';
import { clearCreation, loadCreation, saveCreation, type CreationOwnerScope } from './creationRequestStore';
import { useAdsCatalogs } from './AdsCopyProvider';
import { creativeCopy } from './creative-copy';

type Creative = Extract<AdsNeutralOperation, { type: 'creative.create' }>;
type Review = { operation: Creative; confirmation: string; requestId: string };
type Post = { targetId: string; postId: string; text: string; publishedAt: string | null; thumbnailUrl: string | null };
type Sources = { targets: { id: string; name: string }[]; images: { id: string; mimeType: string }[]; posts?: Post[]; nextTargetOffset: number | null; nextImageAfter: string | null; nameMaxCharacters: number; creativeMessageMaxCharacters: number; creativeTitleMaxCharacters: number; creativeUrlMaxCharacters: number };

/** What a held request was made from, for the recovery line: the image id, or the promoted post id. */
const sourceOf = (operation: Creative) => operation.format === 'post' ? operation.postId : operation.mediaId;

/** initialTargetId / initialPostId preselect a post to promote (the Boost suggestion links here). */
export function CreativeCreateForm({ adAccountId, accountName, ownerScope, locale = 'en', initialTargetId, initialPostId }: { adAccountId: string; accountName: string; ownerScope: CreationOwnerScope; locale?: 'en' | 'fr'; initialTargetId?: string; initialPostId?: string }) {
  const localize = useAdsMessage();
  const { catalogs } = useAdsCatalogs();
  // Wording saved before a release lacks that release's new labels.
  const t = { ...creativeCopy[locale], ...catalogs.creative[locale] };
  const { userId, workspaceId } = ownerScope;
  const owner = useMemo(() => ({ userId, workspaceId }), [userId, workspaceId]);
  const [sources, setSources] = useState<Sources | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [held, setHeld] = useState<Review | null>(null);
  const [format, setFormat] = useState(initialPostId ? 'post' : 'image');
  const [targetId, setTargetId] = useState(initialTargetId ?? '');
  const [postId, setPostId] = useState(initialPostId ?? '');
  const [selectedImage, setSelectedImage] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [draft, setDraft] = useState({ message: '', title: '', linkUrl: '' });
  const [pickError, setPickError] = useState('');
  const transmissions = useRef(0);
  const sending = useRef(false);
  const sourceRequest = useRef(0);
  const [confirm, dialog] = useConfirm({ title: t.confirmTitle, cancel: t.cancel, confirm: t.confirm, danger: false });
  const validation = useFormValidation();

  useEffect(() => {
    const stored = loadCreation<Review>('creative', owner, adAccountId, value => typeof value.requestId === 'string' && typeof value.confirmation === 'string' && Boolean(value.operation && typeof value.operation === 'object' && (value.operation as Creative).type === 'creative.create' && (value.operation as Creative).objectType === 'creative' && (((value.operation as Creative).format === 'post' && ['name', 'targetId', 'postId'].every(key => typeof (value.operation as Record<string, unknown>)[key] === 'string')) || (['name', 'targetId', 'mediaId', 'message', 'title'].every(key => typeof (value.operation as Record<string, unknown>)[key] === 'string') && ['image', 'link'].includes((value.operation as Creative).format) && ((value.operation as Creative).format !== 'link' || typeof (value.operation as Record<string, unknown>).linkUrl === 'string')))));
    if (stored && stored.requestId === stored.request.requestId) { transmissions.current = stored.transmissions; setHeld(stored.request); setFormat(stored.request.operation.format); setTargetId(stored.request.operation.targetId); if (stored.request.operation.format === 'post') setPostId(stored.request.operation.postId); else setSelectedImage(stored.request.operation.mediaId); }
  }, [owner, adAccountId]);
  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++sourceRequest.current;
    setLoading(true); setError('');
    fetch(`/api/ads/management?${new URLSearchParams({ view: 'creative-sources', adAccountId })}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok || !Array.isArray(data.targets) || !Array.isArray(data.images)) throw new Error(); return data as Sources; })
      .then(data => { if (!controller.signal.aborted && sequence === sourceRequest.current) setSources(data); })
      .catch(() => { if (!controller.signal.aborted && sequence === sourceRequest.current) setError(t.failed); })
      .finally(() => { if (!controller.signal.aborted && sequence === sourceRequest.current) setLoading(false); });
    return () => controller.abort();
  }, [adAccountId, reload, t.failed]);

  async function moreSources() {
    if (!sources || loading) return;
    setLoading(true); setError('');
    const sequence = ++sourceRequest.current;
    const params = new URLSearchParams({ view: 'creative-sources', adAccountId, ...(sources.nextTargetOffset !== null ? { targetOffset: String(sources.nextTargetOffset) } : {}), ...(sources.nextImageAfter ? { imageAfter: sources.nextImageAfter } : {}) });
    try {
      const response = await fetch(`/api/ads/management?${params}`);
      const data = await response.json() as Sources;
      if (!response.ok || !Array.isArray(data.targets) || !Array.isArray(data.images)) throw new Error();
      if (sequence !== sourceRequest.current) return;
      setSources(current => current ? { ...data, targets: [...new Map([...current.targets, ...data.targets].map(row => [row.id, row])).values()], images: [...new Map([...current.images, ...data.images].map(row => [row.id, row])).values()], nextTargetOffset: current.nextTargetOffset === null ? null : data.nextTargetOffset, nextImageAfter: current.nextImageAfter === null ? null : data.nextImageAfter } : data);
    } catch { if (sequence === sourceRequest.current) setError(t.failed); } finally { if (sequence === sourceRequest.current) setLoading(false); }
  }

  async function send(request: Review): Promise<string | null> {
    if (sending.current) return t.pending;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    const count = ++transmissions.current;
    if (!saveCreation('creative', owner, adAccountId, request.requestId, request, count)) {
      transmissions.current--; sending.current = false; setBusy(false); return t.storage;
    }
    setHeld(request);
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', adAccountId, ...request }) });
      const data = await response.json();
      const attested = response.ok && data.status === 'resolved_applied';
      const success = response.ok && data.outcome === 'succeeded' && data.recorded === true && typeof data.created?.remoteId === 'string';
      const rejected = response.ok && data.outcome === 'rejected' && (data.terminal === true || data.status === 'rejected');
      if (attested || success || rejected) {
        clearCreation('creative', owner, adAccountId); transmissions.current = 0; setHeld(null);
        setNotice(attested ? t.attested : rejected ? t.rejected : `${data.replay ? t.replay : t.success} (${data.created.remoteId})`);
      } else if (!response.ok && data.attempt === 'not_dispatched' && count === 1) {
        clearCreation('creative', owner, adAccountId); transmissions.current = 0; setHeld(null); return t.failed;
      }
      return null;
    } catch { return null; }
    finally { sending.current = false; setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || held) return;
    setError(''); setNotice('');
    setPickError('');
    if (!validation.validate(event.currentTarget)) { setError(t.invalid); return; }
    const data = new FormData(event.currentTarget);
    const kind = data.get('format') === 'link' ? 'link' : data.get('format') === 'post' ? 'post' : 'image';
    // The picture and post pickers are not native fields, so they are checked here.
    if (kind === 'post' ? !postId : !selectedImage) { setPickError(kind === 'post' ? t.pickPost : t.pickPicture); return; }
    const operation: Creative = kind === 'post'
      ? { type: 'creative.create', objectType: 'creative', name: String(data.get('name')).trim(), targetId: String(data.get('targetId')), format: 'post', postId: String(data.get('postId')) }
      : { type: 'creative.create', objectType: 'creative', name: String(data.get('name')).trim(), targetId: String(data.get('targetId')), mediaId: String(data.get('mediaId')), format: kind, message: String(data.get('message') ?? ''), title: kind === 'link' ? String(data.get('title') ?? '') : '', ...(kind === 'link' ? { linkUrl: String(data.get('linkUrl') ?? '') } : {}) };
    setBusy(true);
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', adAccountId, operation }) });
      const preview = await response.json();
      if (!response.ok || typeof preview.confirmation !== 'string' || preview.blockedByOpenChange !== false) throw new Error();
      const request: Review = { operation: preview.operation, confirmation: preview.confirmation, requestId: globalThis.crypto.randomUUID() };
      setBusy(false);
      const pageLabel = sources?.targets.find(target => target.id === operation.targetId)?.name ?? '';
      await confirm(`${operation.name}${pageLabel ? ` · ${pageLabel}` : ''}. ${operation.format === 'post' ? t.postNote : t.description}`, { pendingLabel: t.pending, failureLabel: t.failed, onConfirm: () => send(request) });
    } catch { setError(t.failed); } finally { setBusy(false); }
  }

  const locked = busy || Boolean(held);
  const imageUrl = (mediaId: string) => `/api/ads/management?${new URLSearchParams({ view: 'creative-image', adAccountId, mediaId })}`;
  const pageName = sources?.targets.find(target => target.id === targetId)?.name ?? '';
  const pickedPost = format === 'post' ? sources?.posts?.find(item => item.postId === postId) : undefined;
  const pagePosts = (sources?.posts ?? []).filter(post => post.targetId === targetId);
  const previewPicture = format === 'post' ? pickedPost?.thumbnailUrl ?? null : selectedImage && !imageFailed ? imageUrl(selectedImage) : null;
  const previewText = format === 'post' ? pickedPost?.text ?? '' : draft.message;
  let linkHost = '';
  try { linkHost = draft.linkUrl ? new URL(draft.linkUrl).host : ''; } catch { /* still typing */ }

  return <section className="ads-creative" aria-label={`${t.title} · ${accountName}`}>
    <header className="ads-creative__head"><h3>{t.title}</h3><p>{accountName} · {t.safe}</p></header>
    {loading && !sources ? <p role="status" className="ads-creative__note">{t.loading}</p> : null}
    {error ? <p role="alert" className="ui-error">{localize(error)} <Button size="sm" onClick={() => setReload(value => value + 1)} disabled={busy || loading}>{t.refresh}</Button></p> : null}
    {notice ? <p role="status" className="ads-creative__done">{localize(notice)}</p> : null}
    {held ? <div role="alert" className="ads-creative__held"><p>{t.held}</p><p><strong>{held.operation.name}</strong></p><Button disabled={busy} onClick={() => void send(held)}>{busy ? t.pending : t.check}</Button> <a href="/ads/manage?level=history#changes">{t.history}</a></div> : null}
    {sources ? <form noValidate onSubmit={submit} aria-label={t.title} className="ads-creative__grid">
      <div className="ads-creative__form">
        <input type="hidden" name="format" value={format} />
        <input type="hidden" name="mediaId" value={selectedImage} />
        <input type="hidden" name="postId" value={postId} />
        <div className="ads-creative__field"><span className="ads-creative__label">{t.format}</span>
          <div className="ads-creative__kinds" role="radiogroup" aria-label={t.format}>
            {([['image', t.photo, t.photoHint], ['link', t.link, t.linkHint], ['post', t.postShort, t.postHint]] as const).map(([value, label, hint]) =>
              <button key={value} type="button" role="radio" aria-checked={format === value} disabled={locked} className="ads-creative__kind" onClick={() => setFormat(value)}><strong>{label}</strong><span>{hint}</span></button>)}
          </div>
        </div>
        <label className="ads-creative__field"><span className="ads-creative__label">{t.channel}</span>
          <select name="targetId" required disabled={locked} {...validation.fieldProps('targetId')} value={targetId} onChange={event => { setTargetId(event.target.value); setPostId(''); }}><option value="">{t.choose}</option>{held && !sources.targets.some(item => item.id === held.operation.targetId) ? <option value={held.operation.targetId}>{t.unavailable}</option> : null}{sources.targets.map(target => <option key={target.id} value={target.id}>{target.name || t.unavailable}</option>)}</select><FieldError {...validation.errorProps('targetId')} /></label>
        {format === 'post' ? <div className="ads-creative__field"><span className="ads-creative__label">{t.postPick}</span>
          {!targetId ? <p className="ads-creative__note">{t.pickPageFirst}</p> : pagePosts.length === 0 ? <p className="ads-creative__note">{t.noPosts}</p>
            : <div className="ads-creative__posts" role="radiogroup" aria-label={t.postPick}>{pagePosts.map(post => <button key={post.postId} type="button" role="radio" aria-checked={postId === post.postId} disabled={locked} className="ads-creative__post" onClick={() => setPostId(post.postId)}>
              {post.thumbnailUrl ? <img src={post.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="ads-creative__nopic" aria-hidden="true" />}
              <span><span className="ads-creative__posttext">{post.text || t.untitledPost}</span>{post.publishedAt ? <small>{new Date(post.publishedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</small> : null}</span>
            </button>)}</div>}
        </div> : <div className="ads-creative__field"><span className="ads-creative__label">{t.picture}</span>
          {sources.images.length === 0 ? <p className="ads-creative__note">{t.empty} <a href="/content/library">{t.mediaLibrary}</a></p>
            : <div className="ads-creative__pictures" role="radiogroup" aria-label={t.picture}>{sources.images.map((image, index) => <button key={image.id} type="button" role="radio" aria-checked={selectedImage === image.id} aria-label={`${t.picture} ${index + 1}`} disabled={locked} className="ads-creative__picture" onClick={() => { setSelectedImage(image.id); setImageFailed(false); }}><img src={imageUrl(image.id)} alt="" loading="lazy" /></button>)}</div>}
          {sources.nextTargetOffset !== null || sources.nextImageAfter ? <button type="button" className="ads-creative__more" onClick={() => void moreSources()} disabled={loading || locked}>{loading ? t.loading : t.more}</button> : null}
        </div>}
        {format !== 'post' ? <label className="ads-creative__field"><span className="ads-creative__label">{t.message}</span><AutoTextarea className="ui-input" rows={3} defaultValue={held && held.operation.format !== 'post' ? held.operation.message : undefined} name="message" maxLength={sources.creativeMessageMaxCharacters} disabled={locked} placeholder={t.messageHint} onChange={event => setDraft(old => ({ ...old, message: event.target.value }))} /></label> : null}
        {format === 'link' ? <div className="ads-creative__pair">
          <label className="ads-creative__field"><span className="ads-creative__label">{t.headline}</span><input name="title" defaultValue={held && held.operation.format !== 'post' ? held.operation.title : undefined} maxLength={sources.creativeTitleMaxCharacters} disabled={locked} onChange={event => setDraft(old => ({ ...old, title: event.target.value }))} /></label>
          <label className="ads-creative__field"><span className="ads-creative__label">{t.destinationShort}</span><input name="linkUrl" defaultValue={held && held.operation.format !== 'post' ? held.operation.linkUrl : undefined} type="url" placeholder="https://" required maxLength={sources.creativeUrlMaxCharacters} disabled={locked} {...validation.fieldProps('linkUrl')} onChange={event => setDraft(old => ({ ...old, linkUrl: event.target.value }))} /><FieldError {...validation.errorProps('linkUrl')} /></label>
        </div> : null}
        <label className="ads-creative__field"><span className="ads-creative__label">{t.name}</span><input name="name" defaultValue={held?.operation.name} required maxLength={sources.nameMaxCharacters} disabled={locked} placeholder={t.nameHint} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /><small className="ads-creative__help">{t.nameHelp}</small></label>
      </div>
      <aside className="ads-creative__preview" aria-label={t.preview}>
        <span className="ads-creative__label">{t.preview}</span>
        <div className="ads-creative__ad">
          <div className="ads-creative__adhead"><span className="ads-creative__avatar" aria-hidden="true">{(pageName || '?').slice(0, 1).toUpperCase()}</span><span><strong>{pageName || t.channel}</strong><small>{t.sponsored}</small></span></div>
          {previewText ? <p className="ads-creative__adtext">{previewText}</p> : <p className="ads-creative__adtext is-empty">{format === 'post' ? t.previewPost : t.previewText}</p>}
          {previewPicture ? <img className="ads-creative__adimage" src={previewPicture} alt="" referrerPolicy="no-referrer" onError={() => { if (format !== 'post') setImageFailed(true); }} /> : <div className="ads-creative__adimage is-empty">{selectedImage && imageFailed ? t.unavailable : t.previewPicture}</div>}
          {format === 'link' ? <div className="ads-creative__adlink"><span><small>{linkHost || 'example.com'}</small><strong>{draft.title || t.headline}</strong></span><span className="ads-creative__cta">{t.learnMore}</span></div> : null}
        </div>
        <p className="ads-creative__help">{t.previewNote}</p>
      </aside>
      <div className="ads-creative__actions">
        {pickError ? <p role="alert" className="ui-error">{pickError}</p> : null}
        <Button type="submit" variant="primary" disabled={locked || loading || !sources.targets.length || (format !== 'post' && !sources.images.length)}>{busy ? t.pending : t.create}</Button>
      </div>
    </form> : null}
    {dialog}
  </section>;
}
