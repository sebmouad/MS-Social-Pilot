'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { SidebarDock } from '@/components/SidebarDock';
import styles from './feeds.module.css';

export type Feed = { id: string; name: string; url: string; kind: 'rss' | 'wordpress'; enabled: boolean; messageTemplate: string; hashtags: string; targetIds: string[]; lastPolledAt: string | null; lastError: string | null; createdAt: string; updatedAt: string };
type Limits = { maxNameCharacters: number; maxMessageCharacters: number; maxTargets: number };
type Checked = { feedId: string; notModified: boolean; draftsCreated: number; destinations: number; entries: Array<{ guid: string; title: string | null; link: string | null; message: string; isNew: boolean; eligible: boolean }> };
const blank = { name: '', url: '', kind: 'rss' as 'rss' | 'wordpress', enabled: true, messageTemplate: '{title}\n\n{link}', hashtags: '', targetIds: [] as string[] };
const errorText = (body: unknown) => body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string' ? (body as { error: string }).error : 'The request could not be confirmed. Refresh the list and check the current feed before trying again.';
const host = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };
const when = (v: string | null) => v && Number.isFinite(Date.parse(v)) ? `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(v))} UTC` : 'Never';
const validFeed = (v: unknown): v is Feed => !!v && typeof v === 'object' && typeof (v as Feed).id === 'string' && typeof (v as Feed).name === 'string' && Array.isArray((v as Feed).targetIds);

export function FeedManager({ initialFeeds, channels, page, hasMore, canWrite = true, limits }: { initialFeeds: Feed[]; channels: Array<{ id: string; name: string }>; page: number; hasMore: boolean; canWrite?: boolean; limits: Limits }) {
  const [feeds, setFeeds] = useState(initialFeeds);
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<Feed | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [review, setReview] = useState<{ kind: 'save' | 'delete' | 'drafts'; feed?: Feed } | null>(null);
  const [checked, setChecked] = useState<{ feed: Feed; result: Checked } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const say = (text: string, error = false) => setNotice(v => ({ error, text, key: (v?.key ?? 0) + 1 }));
  const names = new Map(channels.map(c => [c.id, c.name]));
  const saveWord = editing ? `UPDATE FEED ${editing.id}` : `CREATE FEED ${draft.name.trim()}`;
  const wordFor = (r: NonNullable<typeof review>) => r.kind === 'delete' ? `DELETE FEED ${r.feed!.id}` : r.kind === 'drafts' ? `CREATE FEED DRAFTS ${r.feed!.id}` : saveWord;

  function begin(feed?: Feed) { setEditing(feed ?? null); setDraft(feed ? { name: feed.name, url: feed.url, kind: feed.kind, enabled: feed.enabled, messageTemplate: feed.messageTemplate, hashtags: feed.hashtags, targetIds: feed.targetIds } : blank); setNotice(null); setFormOpen(true); }
  async function call(url: string, method: string, payload: unknown) {
    const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorText(body));
    return body;
  }
  async function run(task: () => Promise<void>, unknown: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try { await task(); } catch (error) { say(error instanceof Error && !(error instanceof TypeError) ? error.message : unknown, true); }
    finally { setBusy(false); inFlight.current = false; }
  }
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!draft.name.trim() || !draft.url.trim() || !draft.messageTemplate.trim()) { say('Enter a name, a feed address and a message template.', true); return; } setConfirmation(''); setReview({ kind: 'save' }); };
  const performSave = () => run(async () => {
    const body = await call(editing ? `/api/feeds/${encodeURIComponent(editing.id)}` : '/api/feeds', editing ? 'PUT' : 'POST', { ...draft, confirmation: saveWord });
    if (!validFeed(body)) throw new Error(errorText(body));
    setFeeds(cur => (editing ? cur.map(f => f.id === body.id ? body : f) : [...cur, body]).sort((a, b) => a.name.localeCompare(b.name)));
    setFormOpen(false); setReview(null); say(editing ? 'Feed updated.' : 'Feed saved. Use Check now to read it.');
  }, 'The save result is unknown. Refresh the list and check the feed before trying again.');
  const performDelete = (feed: Feed) => run(async () => {
    const body = await call(`/api/feeds/${encodeURIComponent(feed.id)}`, 'DELETE', { confirmation: `DELETE FEED ${feed.id}` });
    if (!body || body.deleted !== true || body.id !== feed.id) throw new Error(errorText(body));
    setFeeds(cur => cur.filter(f => f.id !== feed.id)); setReview(null); say('Feed deleted. Drafts already created from it are unchanged.');
  }, 'The deletion result is unknown. Refresh and check the feed before retrying.');
  const performCheck = (feed: Feed, createDrafts: boolean) => run(async () => {
    const body = await call(`/api/feeds/${encodeURIComponent(feed.id)}/check`, 'POST', createDrafts ? { createDrafts: true, confirmation: `CREATE FEED DRAFTS ${feed.id}` } : {});
    if (!body || !Array.isArray(body.entries)) throw new Error(errorText(body));
    setChecked({ feed, result: body as Checked }); setReview(null);
    say(createDrafts ? `${body.draftsCreated} draft${body.draftsCreated === 1 ? '' : 's'} created. Review them in Publishing.` : 'Feed read. Nothing was created.');
  }, 'The check result is unknown. Try again in a moment.');
  const toggle = (id: string) => setDraft(d => ({ ...d, targetIds: d.targetIds.includes(id) ? d.targetIds.filter(x => x !== id) : [...d.targetIds, id] }));

  return <div className={styles.root}>
    {notice && !formOpen && !review && <RouteNotice error={notice.error} focusKey={`feed-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <SidebarDock><div className={styles.search}>{canWrite && <Button variant="primary" onClick={() => begin()}>Add feed</Button>}</div></SidebarDock>
    {feeds.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Content feeds</caption><thead><tr><th scope="col">Feed</th><th scope="col">Channels</th><th scope="col">Last checked</th>{canWrite && <th scope="col">Actions</th>}</tr></thead><tbody>
      {feeds.map(feed => <tr key={feed.id}><th scope="row"><span className={styles.name}>{feed.name}</span><span className={styles.meta}>{host(feed.url)} · {feed.kind === 'wordpress' ? 'WordPress site' : 'RSS or Atom'}{feed.enabled ? '' : ' · Off'}</span></th>
        <td>{feed.targetIds.length ? feed.targetIds.map(id => names.get(id) ?? 'Channel').join(', ') : 'No channels chosen'}</td>
        <td>{when(feed.lastPolledAt)}{feed.lastError && <span className={styles.meta}>{feed.lastError}</span>}</td>
        {canWrite && <td><div className={styles.actions}><Button size="sm" disabled={busy || !feed.enabled} onClick={() => void performCheck(feed, false)}>Check now</Button><Button size="sm" disabled={busy} onClick={() => begin(feed)}>Edit</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => { setConfirmation(''); setReview({ kind: 'delete', feed }); }}>Delete</Button></div></td>}</tr>)}
    </tbody></table></div> : <p className={styles.empty}>No feeds yet. Add a website feed to get a draft for each new article.</p>}
    <nav className={styles.pagination} aria-label="Feed pages">{page > 1 && <a href={`/feeds?page=${page - 1}`}>Previous page</a>}<span>Page {page}</span>{hasMore && <a href={`/feeds?page=${page + 1}`}>Next page</a>}</nav>

    <Dialog open={formOpen} title={editing ? 'Edit feed' : 'Add feed'} description="Saving a feed does not create or publish posts." onClose={() => !busy && setFormOpen(false)} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" form="feed-form" variant="primary" disabled={busy}>{editing ? 'Review changes' : 'Review feed'}</Button></>}>
      {notice?.error && !review && <RouteNotice error focusKey={`feed-form-error:${notice.key}`}>{notice.text}</RouteNotice>}
      <form id="feed-form" className={styles.form} onSubmit={submit} noValidate>
        <label>Name<input disabled={busy} required maxLength={limits.maxNameCharacters} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label>
        <label>Feed address<input disabled={busy} required inputMode="url" placeholder="https://example.com/feed" value={draft.url} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} /></label>
        <label>Feed type<select disabled={busy} value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as 'rss' | 'wordpress' }))}><option value="rss">RSS or Atom feed</option><option value="wordpress">WordPress site (use the site address)</option></select></label>
        <label>Draft message<textarea disabled={busy} required rows={4} maxLength={limits.maxMessageCharacters} value={draft.messageTemplate} onChange={e => setDraft(d => ({ ...d, messageTemplate: e.target.value }))} /><span>Use {'{title}'}, {'{excerpt}'}, {'{link}'} and {'{hashtags}'}.</span></label>
        <label>Hashtags <span>(optional)</span><input disabled={busy} value={draft.hashtags} onChange={e => setDraft(d => ({ ...d, hashtags: e.target.value }))} /></label>
        <fieldset className={styles.checks} disabled={busy}><legend>Channels for the drafts</legend>{channels.length ? channels.map(c => <label key={c.id}><input type="checkbox" checked={draft.targetIds.includes(c.id)} onChange={() => toggle(c.id)} />{c.name}</label>) : <span className={styles.help}>No channels available to you.</span>}</fieldset>
        <label className={styles.inline}><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} /> Feed is on</label>
      </form>
    </Dialog>

    <Dialog open={Boolean(review)} title={review?.kind === 'delete' ? 'Review feed deletion' : review?.kind === 'drafts' ? 'Create drafts from new items' : 'Review feed'} description={review?.kind === 'delete' ? `This removes “${review.feed?.name}”. Drafts already created from it remain in Publishing.` : review?.kind === 'drafts' ? 'This creates one draft per new item. Nothing is scheduled or published.' : 'Confirm to save this feed.'} onClose={() => !busy && setReview(null)} busy={busy}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button variant={review?.kind === 'delete' ? 'danger' : 'primary'} disabled={busy || !review || confirmation !== wordFor(review)} onClick={() => review?.kind === 'delete' ? void performDelete(review.feed!) : review?.kind === 'drafts' ? void performCheck(review.feed!, true) : void performSave()}>{busy ? 'Working…' : review?.kind === 'delete' ? 'Delete feed' : review?.kind === 'drafts' ? 'Create drafts' : 'Confirm save'}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`feed-review-error:${notice.key}`}>{notice.text}</RouteNotice>}
      {review && <label className={styles.confirmLabel}>Type <code>{wordFor(review)}</code> to confirm<input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
    </Dialog>

    <Dialog open={Boolean(checked)} title={checked ? `Check results: ${checked.feed.name}` : ''} description={checked?.result.notModified ? 'The feed has not changed since the last check.' : `${checked?.result.entries.filter(e => e.eligible).length ?? 0} new item(s) can become drafts.`} onClose={() => setChecked(null)}
      actions={<><Button data-dialog-cancel onClick={() => setChecked(null)}>Close</Button>{canWrite && checked && checked.result.entries.some(e => e.eligible) && <Button variant="primary" onClick={() => { const f = checked.feed; setChecked(null); setConfirmation(''); setReview({ kind: 'drafts', feed: f }); }}>Create drafts…</Button>}</>}>
      {checked && (checked.result.entries.length ? <ul className={styles.entries}>{checked.result.entries.map(e => <li key={e.guid}><strong>{e.title ?? e.guid}</strong><span className={styles.meta}>{e.eligible ? 'New' : e.isNew ? 'Older than this feed subscription' : 'Already seen'}</span></li>)}</ul> : <p className={styles.empty}>No items found.</p>)}
      {checked && checked.result.destinations === 0 && <p className={styles.help}>This feed has no channels chosen, so drafts will have no destinations until you add some in Publishing.</p>}
    </Dialog>
  </div>;
}
