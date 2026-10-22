'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { SidebarDock } from '@/components/SidebarDock';
import styles from './media.module.css';

type Holder = { postId: string; status: string; scheduledAt: string | null; excerpt: string };
export type Asset = { id: string; kind: 'image' | 'video'; mimeType: string; name: string; size: number; createdAt: string; width: number | null; height: number | null; source: 'stored-image' | 'library'; inUse: boolean; holderCount: number; holders: Holder[] | null };
type Usage = { usedBytes: number; quotaBytes: number; assetCount: number; approximate: boolean };
const errorText = (body: unknown) => body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string' ? (body as { error: string }).error : 'The request could not be confirmed. Refresh the library and check before trying again.';
const size = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const day = (v: string) => Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(v)) : 'Unknown';

export function MediaLibrary({ items, usage, page, hasMore, filters, canWrite, workspaceWide, usageMayBeIncomplete, maxSearch }: { items: Asset[]; usage: Usage; page: number; hasMore: boolean; filters: { kind: string; usage: string; q: string }; canWrite: boolean; workspaceWide: boolean; usageMayBeIncomplete: boolean; maxSearch: number }) {
  const [assets, setAssets] = useState(items);
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState(''); const [name, setName] = useState('');
  const [removing, setRemoving] = useState<Asset | null>(null);
  const [force, setForce] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const say = (text: string, error = false) => setNotice(v => ({ error, text, key: (v?.key ?? 0) + 1 }));
  const percent = Math.min(100, Math.round((usage.usedBytes / Math.max(1, usage.quotaBytes)) * 100));
  const importWord = `IMPORT MEDIA ${url.trim()}`;
  const deleteWord = removing ? (force ? `DELETE IN-USE MEDIA ${removing.id}` : `DELETE MEDIA ${removing.id}`) : '';
  const query = (p: number) => { const s = new URLSearchParams(); if (filters.kind) s.set('kind', filters.kind); if (filters.usage) s.set('usage', filters.usage); if (filters.q) s.set('q', filters.q); s.set('page', String(p)); return `/media?${s}`; };

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
    say('Imported. Refresh the page to see it in the list.');
  }, 'The import result is unknown. Refresh the library to check before retrying.');
  const performDelete = (asset: Asset) => run(async () => {
    const response = await fetch(`/api/media-library/${encodeURIComponent(asset.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(force ? { allowInUse: true } : {}), confirmation: deleteWord }) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.deleted !== true || body.id !== asset.id) throw new Error(errorText(body));
    setAssets(cur => cur.filter(a => a.id !== asset.id)); setRemoving(null);
    say(body.fileRemoved === 'unconfirmed' ? 'The library entry was removed, but the stored file could not be confirmed as removed.' : 'Media deleted.', body.fileRemoved === 'unconfirmed');
  }, 'The deletion result is unknown. Refresh the library and check before retrying.');

  return <div className={styles.root}>
    {notice && !importing && !removing && <RouteNotice error={notice.error} focusKey={`media-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <SidebarDock><form action="/media" method="get" className={styles.filters} role="search">
      <label htmlFor="media-q">Search media</label><input id="media-q" name="q" defaultValue={filters.q} maxLength={maxSearch} placeholder="File name" />
      <label htmlFor="media-kind">Type</label><select id="media-kind" name="kind" defaultValue={filters.kind}><option value="">Images and videos</option><option value="image">Images</option><option value="video">Videos</option></select>
      <label htmlFor="media-usage">Use</label><select id="media-usage" name="usage" defaultValue={filters.usage}><option value="">All</option><option value="used">Used in posts</option><option value="unused">Not used</option></select>
      <Button type="submit" variant="secondary">Apply</Button>{(filters.q || filters.kind || filters.usage) && <a href="/media">Clear filters</a>}
      {canWrite && <Button type="button" variant="primary" onClick={() => { setNotice(null); setConfirmation(''); setImporting(true); }}>Import from web address</Button>}
    </form></SidebarDock>
    <section className={styles.usage} aria-label="Storage use"><strong>{size(usage.usedBytes)} of {size(usage.quotaBytes)} used{usage.approximate ? ' (approximate)' : ''}</strong>
      <div className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Storage used"><span style={{ width: `${percent}%` }} /></div>
      <span className={styles.meta}>{usage.assetCount} file{usage.assetCount === 1 ? '' : 's'} in this workspace</span></section>
    {usageMayBeIncomplete && <p className={styles.help}>Post usage could not be fully checked, so some assets may appear unused.</p>}
    {assets.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Media library</caption><thead><tr><th scope="col">Preview</th><th scope="col">File</th><th scope="col">Size</th><th scope="col">Use</th>{canWrite && workspaceWide && <th scope="col">Actions</th>}</tr></thead><tbody>
      {assets.map(a => <tr key={a.id}>
        <td>{a.kind === 'image' && a.source === 'stored-image' ? <img className={styles.thumb} src={`/api/media/${encodeURIComponent(a.id)}`} alt="" loading="lazy" /> : <span className={styles.meta}>{a.kind === 'video' ? 'Video' : 'Image'}</span>}</td>
        <th scope="row"><span className={styles.name}>{a.name}</span><span className={styles.meta}>{a.mimeType} · added {day(a.createdAt)}</span></th>
        <td>{size(a.size)}</td>
        <td>{a.inUse ? `Used in ${a.holderCount} post${a.holderCount === 1 ? '' : 's'}` : 'Not used'}{a.holders && a.holders.length > 0 && <ul className={styles.holders}>{a.holders.map(h => <li key={h.postId}>{h.excerpt || 'Untitled post'} ({h.status.replace(/_/g, ' ')})</li>)}</ul>}</td>
        {canWrite && workspaceWide && <td><Button size="sm" variant="danger" disabled={busy} onClick={() => { setNotice(null); setConfirmation(''); setForce(false); setRemoving(a); }}>Delete</Button></td>}
      </tr>)}
    </tbody></table></div> : <p className={styles.empty}>{filters.q || filters.kind || filters.usage ? 'No media matches these filters.' : 'No media yet. Import an image or video from a web address, or upload images when composing a post.'}</p>}
    <nav className={styles.pagination} aria-label="Media pages">{page > 1 && <a href={query(page - 1)}>Previous page</a>}<span>Page {page}</span>{hasMore && <a href={query(page + 1)}>Next page</a>}</nav>
    {canWrite && !workspaceWide && <p className={styles.help}>Deleting media affects posts on every channel, so it needs access to all channels.</p>}

    <Dialog open={importing} title="Import media" description="Only public https addresses are fetched. The file is checked for type, size and your storage limit before it is saved." onClose={() => !busy && setImporting(false)} busy={busy}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setImporting(false)}>Cancel</Button><Button variant="primary" disabled={busy || !url.trim() || confirmation !== importWord} onClick={() => void performImport()}>{busy ? 'Importing…' : 'Import'}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`media-import-error:${notice.key}`}>{notice.text}</RouteNotice>}
      <div className={styles.form}>
        <label>Web address<input disabled={busy} inputMode="url" placeholder="https://example.com/photo.jpg" value={url} onChange={e => setUrl(e.target.value)} /></label>
        <label>Name <span>(optional)</span><input disabled={busy} maxLength={180} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className={styles.confirmLabel}>Type <code>{importWord}</code> to confirm<input autoComplete="off" disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      </div>
    </Dialog>

    <Dialog open={Boolean(removing)} title="Delete media" description={removing?.inUse ? `“${removing.name}” is used by ${removing.holderCount} post${removing.holderCount === 1 ? '' : 's'}. Deleting it can remove the attachment from them.` : `This permanently removes “${removing?.name}”.`} onClose={() => !busy && setRemoving(null)} busy={busy}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" disabled={busy || !removing || confirmation !== deleteWord} onClick={() => removing && void performDelete(removing)}>{busy ? 'Deleting…' : 'Delete media'}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`media-delete-error:${notice.key}`}>{notice.text}</RouteNotice>}
      {removing?.inUse && <label className={styles.inline}><input type="checkbox" checked={force} disabled={busy} onChange={e => { setForce(e.target.checked); setConfirmation(''); }} /> Delete it even though posts use it</label>}
      <label className={styles.confirmLabel}>Type <code>{deleteWord}</code> to confirm<input autoComplete="off" disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
    </Dialog>
  </div>;
}
