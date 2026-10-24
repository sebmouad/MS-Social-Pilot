'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { SidePanel } from '@/components/SidePanel';
import { mediaText, type MediaCopyCatalog, type MediaCopyKey, type MediaLocale } from '../copy';
import styles from './media.module.css';
import { renameMediaAction } from './rename-action';

const PATH = '/content/library';
type Holder = { postId: string; status: string; scheduledAt: string | null; excerpt: string };
export type Asset = { id: string; kind: 'image' | 'video'; mimeType: string; name: string; size: number; createdAt: string; width: number | null; height: number | null; source: 'stored-image' | 'library'; inUse: boolean; holderCount: number; holders: Holder[] | null };
type Usage = { usedBytes: number; quotaBytes: number; assetCount: number; approximate: boolean };
const size = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export function MediaLibrary({ items, usage, page, hasMore, filters, canWrite, workspaceWide, usageMayBeIncomplete, maxSearch, maxName, locale = 'en', copy }: {
  items: Asset[]; usage: Usage; page: number; hasMore: boolean; filters: { kind: string; usage: string; q: string };
  canWrite: boolean; workspaceWide: boolean; usageMayBeIncomplete: boolean; maxSearch: number; maxName: number; locale?: MediaLocale; copy?: MediaCopyCatalog;
}) {
  const router = useRouter();
  const t = (key: MediaCopyKey, values?: Record<string, string | number>) => mediaText(locale, key, values, copy);
  const day = (v: string) => Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(v)) : t('unknownDate');
  const errorText = (body: unknown) => body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string' ? (body as { error: string }).error : t('unconfirmed');
  const [assets, setAssets] = useState(items);
  useEffect(() => setAssets(items), [items]);
  const [searchQuery, setSearchQuery] = useState(filters.q);
  const [kindFilter, setKindFilter] = useState(filters.kind);
  const [usageFilter, setUsageFilter] = useState(filters.usage);
  useEffect(() => { setSearchQuery(filters.q); setKindFilter(filters.kind); setUsageFilter(filters.usage); }, [filters.q, filters.kind, filters.usage]);
  const filterFormRef = useRef<HTMLFormElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitFilters = (nextQ: string, nextKind: string, nextUsage: string) => {
    const s = new URLSearchParams();
    if (nextKind) s.set('kind', nextKind);
    if (nextUsage) s.set('usage', nextUsage);
    if (nextQ.trim()) s.set('q', nextQ.trim());
    const href = `${PATH}${s.toString() ? `?${s}` : ''}`;
    const nav = router as { push?: (url: string) => void };
    if (typeof nav.push === 'function') nav.push(href);
    else filterFormRef.current?.requestSubmit();
  };
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState(''); const [name, setName] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Asset | null>(null);
  const [renameName, setRenameName] = useState('');
  const [removing, setRemoving] = useState<Asset | null>(null);
  const [force, setForce] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [cropAspect, setCropAspect] = useState<'orig' | '1:1' | '4:5' | '9:16' | '1.91:1'>('orig');
  const [showWatermark, setShowWatermark] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const say = (text: string, error = false) => setNotice(v => ({ error, text, key: (v?.key ?? 0) + 1 }));
  const percent = Math.min(100, Math.round((usage.usedBytes / Math.max(1, usage.quotaBytes)) * 100));
  const importWord = `IMPORT MEDIA ${url.trim()}`;
  const deleteWord = removing ? (force ? `DELETE IN-USE MEDIA ${removing.id}` : `DELETE MEDIA ${removing.id}`) : '';
  const query = (p: number) => { const s = new URLSearchParams(); if (kindFilter) s.set('kind', kindFilter); if (usageFilter) s.set('usage', usageFilter); if (searchQuery) s.set('q', searchQuery); s.set('page', String(p)); return `${PATH}?${s}`; };
  const filtered = Boolean(searchQuery || kindFilter || usageFilter);
  const visibleAssets = assets.filter(a => {
    if (kindFilter && a.kind !== kindFilter) return false;
    if (usageFilter === 'used' && !a.inUse) return false;
    if (usageFilter === 'unused' && a.inUse) return false;
    if (searchQuery.trim() && !a.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    return true;
  });
  const usedLabel = (count: number) => count === 1 ? t('usedByOne') : t('usedBy', { count });
  // The open sheet follows the live list, so a rename inside it updates the title without closing.
  const detail = detailId ? assets.find(a => a.id === detailId) ?? null : null;

  async function run(task: () => Promise<void>, unknown: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try { await task(); } catch (error) { say(error instanceof Error && !(error instanceof TypeError) ? error.message : unknown, true); }
    finally { setBusy(false); inFlight.current = false; }
  }
  const performImport = () => run(async () => {
    const response = await fetch('/api/media-library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.trim(), ...(name.trim() ? { name: name.trim() } : {}), confirmation: importWord }) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body.id !== 'string') throw new Error(errorText(body));
    setImporting(false); setUrl(''); setName(''); setConfirmation('');
    say(body.converted === true ? t('importedConverted') : t('imported')); router.refresh();
  }, t('importUnknown'));
  const performUpload = (file: File) => run(async () => {
    const form = new FormData(); form.set('imageFile', file);
    const response = await fetch('/api/media', { method: 'POST', body: form });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body.id !== 'string') throw new Error(response.status === 400 || response.status === 413 ? errorText(body) : t('uploadFailed'));
    say(t('uploaded')); router.refresh();
  }, t('uploadFailed'));
  const performDelete = (asset: Asset) => run(async () => {
    const response = await fetch(`/api/media-library/${encodeURIComponent(asset.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(force ? { allowInUse: true } : {}), confirmation: deleteWord }) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.deleted !== true || body.id !== asset.id) throw new Error(errorText(body));
    setAssets(cur => cur.filter(a => a.id !== asset.id)); setRemoving(null);
    if (asset.id === detailId) setDetailId(null);
    say(body.fileRemoved === 'unconfirmed' ? t('deletedFileUnconfirmed') : t('deleted'), body.fileRemoved === 'unconfirmed');
    router.refresh();
  }, t('deleteUnknown'));

  const performRename = () => run(async () => {
    if (!renaming) return;
    const result = await renameMediaAction({ id: renaming.id, name: renameName.trim(), confirmation });
    if (!('renamed' in result) || result.renamed !== true || result.id !== renaming.id || result.name !== renameName.trim()) throw new Error(errorText(result));
    setAssets(cur => cur.map(a => a.id === result.id ? { ...a, name: result.name } : a));
    setRenaming(null); say(t('renamed')); router.refresh();
  }, t('unconfirmed'));

  return <div className={styles.root}>
    {notice && !importing && !removing && !renaming && <RouteNotice error={notice.error} focusKey={`media-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <form ref={filterFormRef} action={PATH} method="get" className={styles.filters} role="search">
      <div className={styles.field}><label htmlFor="media-q">{t('search')}</label><input id="media-q" name="q" type="search" value={searchQuery} maxLength={maxSearch} placeholder={t('searchPlaceholder')} onChange={e => {
        const next = e.target.value;
        setSearchQuery(next);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => submitFilters(next, kindFilter, usageFilter), 250);
      }} /></div>
      <div className={styles.field}><label htmlFor="media-kind">{t('type')}</label><select id="media-kind" name="kind" value={kindFilter} onChange={e => { const next = e.target.value; setKindFilter(next); submitFilters(searchQuery, next, usageFilter); }}><option value="">{t('typeAll')}</option><option value="image">{t('typeImage')}</option><option value="video">{t('typeVideo')}</option></select></div>
      <div className={styles.field}><label htmlFor="media-usage">{t('use')}</label><select id="media-usage" name="usage" value={usageFilter} onChange={e => { const next = e.target.value; setUsageFilter(next); submitFilters(searchQuery, kindFilter, next); }}><option value="">{t('useAll')}</option><option value="used">{t('useUsed')}</option><option value="unused">{t('useUnused')}</option></select></div>
      {filtered && <a href={PATH}>{t('clear')}</a>}
      {canWrite && <>
        <Button type="button" variant="primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? t('uploading') : t('upload')}</Button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden aria-label={t('upload')} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void performUpload(file); }} />
        <Button type="button" variant="secondary" onClick={() => { setNotice(null); setConfirmation(''); setImporting(true); }}>{t('import')}</Button>
      </>}
    </form>
    <section className={styles.usage} aria-label={t('storage')}><strong>{t('storageUsed', { used: size(usage.usedBytes), quota: size(usage.quotaBytes) })}{usage.approximate ? t('approximate') : ''}</strong>
      <div className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('storageBar')}><span style={{ width: `${percent}%` }} /></div>
      <span className={styles.meta}>{usage.assetCount === 1 ? t('fileCountOne') : t('fileCount', { count: usage.assetCount })}</span></section>
    {usageMayBeIncomplete && <p className={styles.help}>{t('usageIncomplete')}</p>}
    {visibleAssets.length ? <ul className={styles.grid} aria-label={t('tableCaption')}>
      {visibleAssets.map(a => <li key={a.id} className={styles.tile}>
        <div className={styles.preview}>{a.kind === 'image' && a.source === 'stored-image' ? <img className={styles.tileImage} src={`/api/media/${encodeURIComponent(a.id)}`} alt="" loading="lazy" /> : <span className={styles.tileKind}>{a.kind === 'video' ? t('video') : t('image')}</span>}
          <span className={`${styles.badge}${a.inUse ? ` ${styles.badgeUsed}` : ''}`}>{a.inUse ? usedLabel(a.holderCount) : t('unused')}</span></div>
        <div className={styles.tileBody}>
          <span className={styles.name}>{a.name}</span>
          <span className={styles.meta}>{a.mimeType} · {size(a.size)} · {t('added', { date: day(a.createdAt) })}</span>
          {a.holders && a.holders.length > 0 && <ul className={styles.holders}>{a.holders.map(h => <li key={h.postId}>{h.excerpt || t('untitled')} ({h.status.replace(/_/g, ' ')})</li>)}</ul>}
        </div>
        <div className={styles.tileActions}>
          <Button size="sm" variant="secondary" onClick={() => setDetailId(a.id)}>{t('details')}</Button>
          {canWrite && workspaceWide && <Button size="sm" disabled={busy} onClick={() => { setNotice(null); setConfirmation(''); setRenameName(a.name); setRenaming(a); }}>{t('rename')}</Button>}
        </div>
      </li>)}
    </ul> : <p className={styles.empty}>{filtered ? t('noMatch') : t('empty')}</p>}
    <nav className={styles.pagination} aria-label={t('pages')}>
      {page > 1 ? <a className="ui-button ui-button--secondary ui-button--sm" rel="prev" href={query(page - 1)}>{t('previous')}</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">{t('previous')}</span>}
      <span aria-current="page">{t('page', { page })}</span>
      {hasMore ? <a className="ui-button ui-button--secondary ui-button--sm" rel="next" href={query(page + 1)}>{t('next')}</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">{t('next')}</span>}
    </nav>
    {canWrite && !workspaceWide && <p className={styles.help}>{t('deleteNeedsAll')}</p>}

    {detail ? <SidePanel open title={detail.name} closeLabel={t('close')} onClose={() => setDetailId(null)}
      actions={canWrite && workspaceWide ? <><Button size="sm" disabled={busy} onClick={() => { setNotice(null); setConfirmation(''); setRenameName(detail.name); setRenaming(detail); }}>{t('rename')}</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => { setNotice(null); setConfirmation(''); setForce(false); setRemoving(detail); }}>{t('delete')}</Button></> : undefined}>
      <div className={styles.detail}>
        <div className={styles.detailPreview} style={{ position: 'relative' }}>
          {detail.kind === 'image' && detail.source === 'stored-image' ? (
            <div style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              aspectRatio: cropAspect === '1:1' ? '1 / 1' : cropAspect === '4:5' ? '4 / 5' : cropAspect === '9:16' ? '9 / 16' : cropAspect === '1.91:1' ? '1.91 / 1' : undefined,
              maxHeight: '22rem',
              overflow: 'hidden',
              position: 'relative'
            }}>
              <img
                className={styles.detailImage}
                src={`/api/media/${encodeURIComponent(detail.id)}`}
                alt=""
                style={{ objectFit: cropAspect === 'orig' ? 'contain' : 'cover', width: '100%', height: '100%' }}
              />
              {showWatermark && <span className={styles.watermarkOverlay}>© MS SOCIAL PILOT</span>}
            </div>
          ) : <span className={styles.tileKind}>{detail.kind === 'video' ? t('video') : t('image')}</span>}
        </div>

        {detail.kind === 'image' && (
          <div className={styles.cropSection}>
            <p className={styles.cropTitle}>Non-Destructive Crop & Presets</p>
            <div className={styles.cropPresets}>
              <button type="button" className={styles.cropPresetBtn} data-active={cropAspect === 'orig'} onClick={() => setCropAspect('orig')}>Original</button>
              <button type="button" className={styles.cropPresetBtn} data-active={cropAspect === '1:1'} onClick={() => setCropAspect('1:1')}>1:1 Square</button>
              <button type="button" className={styles.cropPresetBtn} data-active={cropAspect === '4:5'} onClick={() => setCropAspect('4:5')}>4:5 Portrait</button>
              <button type="button" className={styles.cropPresetBtn} data-active={cropAspect === '9:16'} onClick={() => setCropAspect('9:16')}>9:16 Story/Reel</button>
              <button type="button" className={styles.cropPresetBtn} data-active={cropAspect === '1.91:1'} onClick={() => setCropAspect('1.91:1')}>1.91:1 Landscape</button>
            </div>
            <label className={styles.watermarkToggle}>
              <input type="checkbox" checked={showWatermark} onChange={e => setShowWatermark(e.target.checked)} />
              <span>Preview Workspace Watermark</span>
            </label>
          </div>
        )}
        <dl className={styles.facts}>
          <div><dt>{t('type')}</dt><dd>{detail.kind === 'video' ? t('video') : t('image')}</dd></div>
          <div><dt>{t('colFile')}</dt><dd>{detail.mimeType} · {size(detail.size)}</dd></div>
          {detail.width !== null && detail.height !== null ? <div><dt>{t('dimensionsLabel')}</dt><dd>{t('dimensions', { width: detail.width, height: detail.height })}</dd></div> : null}
          <div><dt>{t('use')}</dt><dd>{detail.inUse ? usedLabel(detail.holderCount) : t('unused')}</dd></div>
          <div><dt>{t('addedLabel')}</dt><dd>{t('added', { date: day(detail.createdAt) })}</dd></div>
        </dl>
        {detail.inUse && detail.holders && detail.holders.length > 0 ? <section aria-label={t('usedIn')}>
          <h3>{t('usedIn')}</h3>
          <ul className={styles.detailHolders}>{detail.holders.map(h => <li key={h.postId}>
            <a href={`/content/post/${encodeURIComponent(h.postId)}`} title={t('openPost')}>{h.excerpt || t('untitled')}</a>
            <span className={styles.meta}>{h.status.replace(/_/g, ' ')}</span>
          </li>)}</ul>
          {detail.holderCount > detail.holders.length ? <p className={styles.help}>{t('holdersPartial', { shown: detail.holders.length, count: detail.holderCount })}</p> : null}
        </section> : null}
      </div>
    </SidePanel> : null}

    <Dialog open={Boolean(renaming)} title={t('renameTitle')} onClose={() => !busy && setRenaming(null)} busy={busy}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setRenaming(null)}>{t('cancel')}</Button><Button variant="primary" disabled={busy || !renameName.trim() || confirmation !== `RENAME MEDIA ${renaming?.id}`} onClick={() => void performRename()}>{t('rename')}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`media-rename-error:${notice.key}`}>{notice.text}</RouteNotice>}
      <label>{t('renameName')}<input disabled={busy} maxLength={maxName} value={renameName} onChange={e => setRenameName(e.target.value)} /></label>
      <label>{t('importConfirm', { phrase: `RENAME MEDIA ${renaming?.id ?? ''}` })}<input disabled={busy} autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
    </Dialog>

    <Dialog open={importing} title={t('importTitle')} description={t('importDescription')} onClose={() => !busy && setImporting(false)} busy={busy}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setImporting(false)}>{t('cancel')}</Button><Button variant="primary" disabled={busy || !url.trim() || confirmation !== importWord} onClick={() => void performImport()}>{busy ? t('importing') : t('importAction')}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`media-import-error:${notice.key}`}>{notice.text}</RouteNotice>}
      <div className={styles.form}>
        <label>{t('importAddress')}<input disabled={busy} inputMode="url" placeholder="https://example.com/photo.jpg" value={url} onChange={e => setUrl(e.target.value)} /></label>
        <label>{t('importName')}<input disabled={busy} maxLength={maxName} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className={styles.confirmLabel}>{t('importConfirm', { phrase: importWord })}<input autoComplete="off" disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      </div>
    </Dialog>

    <Dialog open={Boolean(removing)} title={t('deleteTitle')} description={removing ? (removing.inUse ? (removing.holderCount === 1 ? t('deleteInUseOne', { name: removing.name }) : t('deleteInUse', { name: removing.name, count: removing.holderCount })) : t('deleteDescription', { name: removing.name })) : ''} onClose={() => !busy && setRemoving(null)} busy={busy}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setRemoving(null)}>{t('cancel')}</Button><Button variant="danger" disabled={busy || !removing || confirmation !== deleteWord} onClick={() => removing && void performDelete(removing)}>{busy ? t('deleting') : t('deleteAction')}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`media-delete-error:${notice.key}`}>{notice.text}</RouteNotice>}
      {removing?.inUse && <label className={styles.inline}><input type="checkbox" checked={force} disabled={busy} onChange={e => { setForce(e.target.checked); setConfirmation(''); }} /> {t('deleteForce')}</label>}
      <label className={styles.confirmLabel}>{t('importConfirm', { phrase: deleteWord })}<input autoComplete="off" disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
    </Dialog>
  </div>;
}
