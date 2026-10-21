'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { SidebarDock } from '@/components/SidebarDock';
import { mediaText, type MediaCopyCatalog, type MediaCopyKey, type MediaLocale } from '../copy';
import styles from './media.module.css';
import { renameMediaAction } from './rename-action';

const PATH = '/publishing/media';
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
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState(''); const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<Asset | null>(null);
  const [renameName, setRenameName] = useState('');
  const [removing, setRemoving] = useState<Asset | null>(null);
  const [force, setForce] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const say = (text: string, error = false) => setNotice(v => ({ error, text, key: (v?.key ?? 0) + 1 }));
  const percent = Math.min(100, Math.round((usage.usedBytes / Math.max(1, usage.quotaBytes)) * 100));
  const importWord = `IMPORT MEDIA ${url.trim()}`;
  const deleteWord = removing ? (force ? `DELETE IN-USE MEDIA ${removing.id}` : `DELETE MEDIA ${removing.id}`) : '';
  const query = (p: number) => { const s = new URLSearchParams(); if (filters.kind) s.set('kind', filters.kind); if (filters.usage) s.set('usage', filters.usage); if (filters.q) s.set('q', filters.q); s.set('page', String(p)); return `${PATH}?${s}`; };
  const filtered = Boolean(filters.q || filters.kind || filters.usage);
  const usedLabel = (count: number) => count === 1 ? t('usedByOne') : t('usedBy', { count });

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
    say(t('imported')); router.refresh();
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
    <SidebarDock><form action={PATH} method="get" className={styles.filters} role="search">
      <label htmlFor="media-q">{t('search')}</label><input id="media-q" name="q" defaultValue={filters.q} maxLength={maxSearch} placeholder={t('searchPlaceholder')} />
      <label htmlFor="media-kind">{t('type')}</label><select id="media-kind" name="kind" defaultValue={filters.kind}><option value="">{t('typeAll')}</option><option value="image">{t('typeImage')}</option><option value="video">{t('typeVideo')}</option></select>
      <label htmlFor="media-usage">{t('use')}</label><select id="media-usage" name="usage" defaultValue={filters.usage}><option value="">{t('useAll')}</option><option value="used">{t('useUsed')}</option><option value="unused">{t('useUnused')}</option></select>
      <Button type="submit" variant="secondary">{t('apply')}</Button>{filtered && <a href={PATH}>{t('clear')}</a>}
      {canWrite && <>
        <Button type="button" variant="primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? t('uploading') : t('upload')}</Button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden aria-label={t('upload')} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void performUpload(file); }} />
        <Button type="button" variant="secondary" onClick={() => { setNotice(null); setConfirmation(''); setImporting(true); }}>{t('import')}</Button>
      </>}
    </form></SidebarDock>
    <section className={styles.usage} aria-label={t('storage')}><strong>{t('storageUsed', { used: size(usage.usedBytes), quota: size(usage.quotaBytes) })}{usage.approximate ? t('approximate') : ''}</strong>
      <div className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('storageBar')}><span style={{ width: `${percent}%` }} /></div>
      <span className={styles.meta}>{usage.assetCount === 1 ? t('fileCountOne') : t('fileCount', { count: usage.assetCount })}</span></section>
    {usageMayBeIncomplete && <p className={styles.help}>{t('usageIncomplete')}</p>}
    {assets.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{t('tableCaption')}</caption><thead><tr><th scope="col">{t('colPreview')}</th><th scope="col">{t('colFile')}</th><th scope="col">{t('colSize')}</th><th scope="col">{t('colUse')}</th>{canWrite && workspaceWide && <th scope="col">{t('colActions')}</th>}</tr></thead><tbody>
      {assets.map(a => <tr key={a.id}>
        <td>{a.kind === 'image' && a.source === 'stored-image' ? <img className={styles.thumb} src={`/api/media/${encodeURIComponent(a.id)}`} alt="" loading="lazy" /> : <span className={styles.meta}>{a.kind === 'video' ? t('video') : t('image')}</span>}</td>
        <th scope="row"><span className={styles.name}>{a.name}</span><span className={styles.meta}>{a.mimeType} · {t('added', { date: day(a.createdAt) })}</span></th>
        <td>{size(a.size)}</td>
        <td>{a.inUse ? usedLabel(a.holderCount) : t('unused')}{a.holders && a.holders.length > 0 && <ul className={styles.holders}>{a.holders.map(h => <li key={h.postId}>{h.excerpt || t('untitled')} ({h.status.replace(/_/g, ' ')})</li>)}</ul>}</td>
        {canWrite && workspaceWide && <td>{a.source === 'library' && <Button size="sm" disabled={busy} onClick={() => { setNotice(null); setConfirmation(''); setRenameName(a.name); setRenaming(a); }}>{t('rename')}</Button>}<Button size="sm" variant="danger" disabled={busy} aria-label={`${t('delete')} ${a.name}`} onClick={() => { setNotice(null); setConfirmation(''); setForce(false); setRemoving(a); }}>{t('delete')}</Button></td>}
      </tr>)}
    </tbody></table></div> : <p className={styles.empty}>{filtered ? t('noMatch') : t('empty')}</p>}
    <nav className={styles.pagination} aria-label={t('pages')}>{page > 1 && <a href={query(page - 1)}>{t('previous')}</a>}<span>{t('page', { page })}</span>{hasMore && <a href={query(page + 1)}>{t('next')}</a>}</nav>
    {canWrite && !workspaceWide && <p className={styles.help}>{t('deleteNeedsAll')}</p>}

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
