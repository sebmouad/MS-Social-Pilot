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
  const t = catalogs.creative[locale];
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
    if (!validation.validate(event.currentTarget)) { setError(t.invalid); return; }
    const data = new FormData(event.currentTarget);
    const kind = data.get('format') === 'link' ? 'link' : data.get('format') === 'post' ? 'post' : 'image';
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
      await confirm(operation.format === 'post' ? `${accountName} · ${operation.name} · ${sources?.posts?.find(post => post.postId === operation.postId)?.text.slice(0, 120) ?? operation.postId}. ${t.postNote}` : `${accountName} · ${operation.name} · ${operation.mediaId} · ${operation.title} · ${operation.message}${operation.linkUrl ? ` · ${operation.linkUrl}` : ""}. ${t.description}`, { exactConfirmation: request.confirmation, confirmationLabel: t.exact, pendingLabel: t.pending, failureLabel: t.failed, onConfirm: () => send(request) });
    } catch { setError(t.failed); } finally { setBusy(false); }
  }

  const locked = busy || Boolean(held);
  return <section className="ads-campaign-create ads-creative-create" aria-label={`${t.title} · ${accountName}`}>
    <h3>{t.title} · {accountName}</h3><p className="small-note">{t.description}</p>
    {loading ? <p role="status">{t.loading}</p> : null}
    {error ? <p role="alert" className="ui-error">{localize(error)} <Button onClick={() => setReload(value => value + 1)} disabled={busy || loading}>{t.refresh}</Button></p> : null}
    {notice ? <p role="status">{localize(notice)}</p> : null}
    {held ? <div role="alert"><p>{t.held}</p><p><strong>{held.operation.name}</strong> · {sourceOf(held.operation)}</p><Button disabled={busy} onClick={() => void send(held)}>{busy ? t.pending : t.check}</Button> <a href="/ads/manage#changes">{t.history}</a></div> : null}
    {sources ? <form noValidate onSubmit={submit} aria-label={t.title}>
      <div className="ads-campaign-create__fields">
        <label>{t.name}<input name="name" defaultValue={held?.operation.name} required maxLength={sources.nameMaxCharacters} disabled={locked} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
        <label>{t.channel}<select name="targetId" required disabled={locked} {...validation.fieldProps('targetId')} value={targetId} onChange={event => { setTargetId(event.target.value); setPostId(''); }}><option value="">{t.choose}</option>{held && !sources.targets.some(item => item.id === held.operation.targetId) ? <option value={held.operation.targetId}>{t.unavailable} · {held.operation.targetId}</option> : null}{sources.targets.map(target => <option key={target.id} value={target.id}>{target.name || t.unavailable}</option>)}</select><FieldError {...validation.errorProps('targetId')} /></label>
        {format === 'post' ? <label>{t.postPick}<select name="postId" required disabled={locked || !targetId} {...validation.fieldProps('postId')} value={postId} onChange={event => setPostId(event.target.value)}><option value="">{t.choose}</option>{(sources.posts ?? []).filter(post => post.targetId === targetId).map(post => <option key={post.postId} value={post.postId}>{post.publishedAt ? `${new Date(post.publishedAt).toLocaleDateString(locale)} · ` : ''}{post.text.slice(0, 80) || post.postId}</option>)}</select><FieldError {...validation.errorProps('postId')} />{targetId && !(sources.posts ?? []).some(post => post.targetId === targetId) ? <span className="small-note">{t.noPosts}</span> : null}</label> : null}
        {format !== 'post' ? <label>{t.image}<select name="mediaId" onChange={event => { setSelectedImage(event.target.value); setImageFailed(false); }} required disabled={locked} {...validation.fieldProps('mediaId')} defaultValue={held && held.operation.format !== 'post' ? held.operation.mediaId : ""}><option value="">{t.choose}</option>{held && held.operation.format !== 'post' && !sources.images.some(item => item.id === sourceOf(held.operation)) ? <option value={sourceOf(held.operation)}>{t.unavailable} · {sourceOf(held.operation)}</option> : null}{sources.images.map(image => <option key={image.id} value={image.id}>{image.id} · {image.mimeType || t.unavailable}</option>)}</select><FieldError {...validation.errorProps('mediaId')} /></label> : null}
        <label>{t.format}<select name="format" value={format} onChange={event => setFormat(event.target.value)} disabled={locked}><option value="post">{t.post}</option><option value="image">{t.photo}</option><option value="link">{t.link}</option></select></label>
        {format !== 'post' ? <label>{t.message}<AutoTextarea defaultValue={held && held.operation.format !== 'post' ? held.operation.message : undefined} name="message" maxLength={sources.creativeMessageMaxCharacters} disabled={locked} /></label> : null}
        {format === 'link' ? <><label>{t.headline}<input name="title" defaultValue={held && held.operation.format !== 'post' ? held.operation.title : undefined} maxLength={sources.creativeTitleMaxCharacters} disabled={locked} /></label><label>{t.destination}<input name="linkUrl" defaultValue={held && held.operation.format !== 'post' ? held.operation.linkUrl : undefined} type="url" required maxLength={sources.creativeUrlMaxCharacters} disabled={locked} {...validation.fieldProps('linkUrl')} /><FieldError {...validation.errorProps('linkUrl')} /></label></> : null}
      </div>
      {format === 'post' && postId ? (() => { const post = sources.posts?.find(item => item.postId === postId); return post?.thumbnailUrl ? <img className="ads-creative-image" width="160" height="120" src={post.thumbnailUrl} alt={t.postPick} referrerPolicy="no-referrer" /> : null; })()
        : selectedImage && imageFailed ? <p>{t.unavailable}</p> : selectedImage ? <img onError={() => setImageFailed(true)} className="ads-creative-image" width="160" height="120" src={`/api/ads/management?${new URLSearchParams({ view: "creative-image", adAccountId, mediaId: selectedImage })}`} alt={t.image} /> : null}
      {sources.nextTargetOffset !== null || sources.nextImageAfter ? <Button onClick={() => void moreSources()} disabled={loading || locked}>{t.more}</Button> : null}
      {format !== 'post' && (!sources.targets.length || !sources.images.length) ? <p>{t.empty} <a href="/content/library">{t.mediaLibrary}</a></p> : null}
      <Button type="submit" variant="primary" disabled={locked || loading || !sources.targets.length || (format !== 'post' && !sources.images.length)}>{busy ? t.pending : t.review}</Button>
    </form> : null}
    {dialog}
  </section>;
}
