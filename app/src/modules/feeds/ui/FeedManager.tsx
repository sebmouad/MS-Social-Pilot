'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { feedsCopy, feedsText, type FeedsCopyCatalog, type FeedsCopyKey, type FeedsLocale } from '../copy';
import styles from './feeds.module.css';

type Handling = 'review' | 'schedule';
export type Feed = { id: string; name: string; url: string; kind: 'rss' | 'wordpress'; enabled: boolean; messageTemplate: string; hashtags: string; targetIds: string[]; handling: Handling; spreadMinutes: number; failureCount: number; lastPolledAt: string | null; lastError: string | null; createdAt: string; updatedAt: string };
type Limits = { maxNameCharacters: number; maxMessageCharacters: number; maxTargets: number; maxSpreadMinutes: number };
type Checked = { feedId: string; notModified: boolean; draftsCreated: number; postsCreated: number; held: number; reviewerNotificationsQueued?: number; backlog: boolean; destinations: number; entries: Array<{ guid: string; title: string | null; link: string | null; message: string; isNew: boolean; eligible: boolean }> };
type Review = { kind: 'save' | 'delete' | 'drafts' | 'posts'; feed?: Feed };
const blank = { name: '', url: '', kind: 'rss' as 'rss' | 'wordpress', enabled: true, messageTemplate: '{title}\n\n{link}', hashtags: '', targetIds: [] as string[], handling: 'review' as Handling, spreadMinutes: 0 };
const host = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };
const validFeed = (v: unknown): v is Feed => !!v && typeof v === 'object' && typeof (v as Feed).id === 'string' && typeof (v as Feed).name === 'string' && Array.isArray((v as Feed).targetIds);
/** A literal sample so the author sees what the text produces; the server renders the real thing. */
const sample = (template: string, hashtags: string, t: (key: FeedsCopyKey) => string) => template
  .replace(/\{\{?\s*title\s*\}?\}/gi, t('sampleTitle')).replace(/\{\{?\s*(excerpt|description)\s*\}?\}/gi, t('sampleExcerpt'))
  .replace(/\{\{?\s*link\s*\}?\}/gi, 'https://example.com/article').replace(/\{\{?\s*hashtags\s*\}?\}/gi, hashtags.trim()).replace(/\n{3,}/g, '\n\n').trim();

export function FeedManager({ initialFeeds, channels, page, hasMore, canWrite = true, limits, locale, automaticMinutes, copy = feedsCopy }: { initialFeeds: Feed[]; channels: Array<{ id: string; name: string }>; page: number; hasMore: boolean; canWrite?: boolean; limits: Limits; locale: FeedsLocale; automaticMinutes: number | null; copy?: FeedsCopyCatalog }) {
  const t = (key: FeedsCopyKey, values: Record<string, string | number> = {}) => feedsText(locale, key, values, copy);
  const [feeds, setFeeds] = useState(initialFeeds);
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<Feed | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [checked, setChecked] = useState<{ feed: Feed; result: Checked } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const say = (text: string, error = false) => setNotice(v => ({ error, text, key: (v?.key ?? 0) + 1 }));
  const names = new Map(channels.map(c => [c.id, c.name]));
  const when = (v: string | null) => v && Number.isFinite(Date.parse(v)) ? `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(v))} UTC` : t('never');
  const errorText = (body: unknown) => body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string' ? (body as { error: string }).error : t('unknownRequest');
  const saveWord = editing ? `UPDATE FEED ${editing.id}` : `CREATE FEED ${draft.name.trim()}`;
  const wordFor = (r: Review) => r.kind === 'delete' ? `DELETE FEED ${r.feed!.id}` : r.kind === 'drafts' ? `CREATE FEED DRAFTS ${r.feed!.id}` : r.kind === 'posts' ? `CREATE FEED POSTS ${r.feed!.id}` : saveWord;
  const confirmParts = copy[locale].typeToConfirm.split('{phrase}');
  const handlingText = (h: Handling) => t(h === 'schedule' ? 'handlingSchedule' : 'handlingReview');

  function begin(feed?: Feed) { setEditing(feed ?? null); setDraft(feed ? { name: feed.name, url: feed.url, kind: feed.kind, enabled: feed.enabled, messageTemplate: feed.messageTemplate, hashtags: feed.hashtags, targetIds: feed.targetIds, handling: feed.handling, spreadMinutes: feed.spreadMinutes } : blank); setNotice(null); setFormOpen(true); }
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
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!draft.name.trim() || !draft.url.trim() || !draft.messageTemplate.trim()) { say(t('enterRequired'), true); return; } setConfirmation(''); setReview({ kind: 'save' }); };
  const performSave = () => run(async () => {
    const body = await call(editing ? `/api/feeds/${encodeURIComponent(editing.id)}` : '/api/feeds', editing ? 'PUT' : 'POST', { ...draft, confirmation: saveWord });
    if (!validFeed(body)) throw new Error(errorText(body));
    setFeeds(cur => (editing ? cur.map(f => f.id === body.id ? body : f) : [...cur, body]).sort((a, b) => a.name.localeCompare(b.name)));
    setFormOpen(false); setReview(null); say(editing ? t('updated') : t('saved'));
  }, t('unknownSave'));
  const performDelete = (feed: Feed) => run(async () => {
    const body = await call(`/api/feeds/${encodeURIComponent(feed.id)}`, 'DELETE', { confirmation: `DELETE FEED ${feed.id}` });
    if (!body || body.deleted !== true || body.id !== feed.id) throw new Error(errorText(body));
    setFeeds(cur => cur.filter(f => f.id !== feed.id)); setReview(null); say(t('deleted'));
  }, t('unknownDelete'));
  const performCheck = (feed: Feed, mode: 'preview' | 'drafts' | 'posts') => run(async () => {
    const payload = mode === 'preview' ? {} : { mode, confirmation: mode === 'drafts' ? `CREATE FEED DRAFTS ${feed.id}` : `CREATE FEED POSTS ${feed.id}` };
    const body = await call(`/api/feeds/${encodeURIComponent(feed.id)}/check`, 'POST', payload);
    if (!body || !Array.isArray(body.entries)) throw new Error(errorText(body));
    setChecked({ feed, result: body as Checked }); setReview(null);
    say(mode === 'drafts' ? t('draftsCreated', { count: body.draftsCreated }) : mode === 'posts' ? t('postsCreated', { count: body.postsCreated, held: body.held }) : t('checkedNothing'));
  }, t('unknownCheck'));
  const toggle = (id: string) => setDraft(d => ({ ...d, targetIds: d.targetIds.includes(id) ? d.targetIds.filter(x => x !== id) : [...d.targetIds, id] }));
  const preview = sample(draft.messageTemplate, draft.hashtags, t);
  const eligible = checked?.result.entries.filter(e => e.eligible && e.message.trim()).length ?? 0;
  const reviewTitle = !review ? '' : t(review.kind === 'delete' ? 'reviewDeleteTitle' : review.kind === 'drafts' ? 'reviewDraftsTitle' : review.kind === 'posts' ? 'reviewPostsTitle' : 'reviewSaveTitle');
  const reviewText = !review ? '' : review.kind === 'delete' ? t('reviewDeleteDescription', { name: review.feed?.name ?? '' }) : review.kind === 'drafts' ? t('reviewDraftsDescription') : review.kind === 'posts' ? t('reviewPostsDescription', { handling: handlingText(review.feed!.handling) }) : t('reviewSaveDescription');
  const reviewAction = !review ? '' : t(review.kind === 'delete' ? 'confirmDelete' : review.kind === 'drafts' ? 'confirmDrafts' : review.kind === 'posts' ? 'confirmPosts' : 'confirmSave');

  return <div className={styles.root}>
    {notice && !formOpen && !review && <RouteNotice error={notice.error} focusKey={`feed-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <p className={styles.help}>{t('reviewNotice')}</p>
    <p className={styles.help}>{automaticMinutes ? t('automatic', { minutes: automaticMinutes }) : t('manualOnly')}</p>
    {canWrite && <div className={styles.search}><Button variant="primary" onClick={() => begin()}>{t('add')}</Button></div>}
    {feeds.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{t('title')}</caption><thead><tr><th scope="col">{t('colFeed')}</th><th scope="col">{t('colChannels')}</th><th scope="col">{t('colHandling')}</th><th scope="col">{t('colChecked')}</th>{canWrite && <th scope="col">{t('colActions')}</th>}</tr></thead><tbody>
      {feeds.map(feed => <tr key={feed.id}><th scope="row"><span className={styles.name}>{feed.name}</span><span className={styles.meta}>{host(feed.url)} · {t(feed.kind === 'wordpress' ? 'kindWordpress' : 'kindRss')}{feed.enabled ? '' : ` · ${t('off')}`}</span></th>
        <td>{feed.targetIds.length ? feed.targetIds.map(id => names.get(id) ?? t('channel')).join(', ') : t('noChannels')}</td>
        <td>{handlingText(feed.handling)}<span className={styles.meta}>{feed.spreadMinutes > 0 ? t('spreadEvery', { minutes: feed.spreadMinutes }) : t('spreadNone')}</span></td>
        <td>{when(feed.lastPolledAt)}{feed.failureCount > 0 && <span className={styles.meta}>{t('failures', { count: feed.failureCount })}</span>}{feed.lastError && <span className={styles.meta}>{feed.lastError}</span>}</td>
        {canWrite && <td><div className={styles.actions}><Button size="sm" disabled={busy || !feed.enabled} onClick={() => void performCheck(feed, 'preview')}>{t('checkNow')}</Button><Button size="sm" disabled={busy} onClick={() => begin(feed)}>{t('edit')}</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => { setConfirmation(''); setReview({ kind: 'delete', feed }); }}>{t('delete')}</Button></div></td>}</tr>)}
    </tbody></table></div> : <p className={styles.empty}>{t('empty')}</p>}
    <nav className={styles.pagination} aria-label={t('pagesNav')}>{page > 1 && <a href={`/content/feeds?page=${page - 1}`}>{t('previous')}</a>}<span>{t('pageLabel', { page })}</span>{hasMore && <a href={`/content/feeds?page=${page + 1}`}>{t('next')}</a>}</nav>

    <Dialog open={formOpen} title={editing ? t('dialogEdit') : t('dialogAdd')} description={t('dialogDescription')} onClose={() => !busy && setFormOpen(false)} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setFormOpen(false)}>{t('cancel')}</Button><Button type="submit" form="feed-form" variant="primary" disabled={busy}>{editing ? t('reviewChanges') : t('reviewFeed')}</Button></>}>
      {notice?.error && !review && <RouteNotice error focusKey={`feed-form-error:${notice.key}`}>{notice.text}</RouteNotice>}
      <form id="feed-form" className={styles.form} onSubmit={submit} noValidate>
        <label>{t('name')}<input disabled={busy} required maxLength={limits.maxNameCharacters} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label>
        <label>{t('kind')}<select disabled={busy} value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as 'rss' | 'wordpress' }))}><option value="rss">{t('kindRssOption')}</option><option value="wordpress">{t('kindWordpressOption')}</option></select></label>
        <label>{t(draft.kind === 'wordpress' ? 'urlWordpress' : 'urlRss')}<input disabled={busy} required inputMode="url" placeholder="https://example.com/feed" value={draft.url} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} /><span>{t(draft.kind === 'wordpress' ? 'kindWordpressHint' : 'kindRssHint')}</span></label>
        <label>{t('template')}<textarea disabled={busy} required rows={4} maxLength={limits.maxMessageCharacters} value={draft.messageTemplate} onChange={e => setDraft(d => ({ ...d, messageTemplate: e.target.value }))} /><span>{t('templateHint')}</span></label>
        <label>{t('hashtags')}<input disabled={busy} value={draft.hashtags} onChange={e => setDraft(d => ({ ...d, hashtags: e.target.value }))} /><span>{t('hashtagsHint')}</span></label>
        <div><strong>{t('preview')}</strong><p className={styles.reviewPreview}>{preview || t('previewEmpty')}</p></div>
        <fieldset className={styles.checks} disabled={busy}><legend>{t('channels')}</legend>{channels.length ? channels.map(c => <label key={c.id}><input type="checkbox" checked={draft.targetIds.includes(c.id)} onChange={() => toggle(c.id)} />{c.name}</label>) : <span className={styles.help}>{t('noChannelsAvailable')}</span>}</fieldset>
        <label>{t('handling')}<select disabled={busy} value={draft.handling} onChange={e => setDraft(d => ({ ...d, handling: e.target.value as Handling }))}><option value="review">{t('handlingReviewOption')}</option><option value="schedule">{t('handlingScheduleOption')}</option></select><span>{t('handlingHint')}</span></label>
        <label>{t('spread')}<input disabled={busy} type="number" inputMode="numeric" min={0} max={limits.maxSpreadMinutes} step={1} value={draft.spreadMinutes} onChange={e => setDraft(d => ({ ...d, spreadMinutes: Math.max(0, Math.min(limits.maxSpreadMinutes, Math.trunc(Number(e.target.value)) || 0)) }))} /><span>{t('spreadHint')}</span></label>
        <label className={styles.inline}><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} /> {t('enabled')}</label>
      </form>
    </Dialog>

    <Dialog open={Boolean(review)} title={reviewTitle} description={reviewText} onClose={() => !busy && setReview(null)} busy={busy}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setReview(null)}>{t('cancel')}</Button><Button variant={review?.kind === 'delete' ? 'danger' : 'primary'} disabled={busy || !review || confirmation !== wordFor(review)} onClick={() => review?.kind === 'delete' ? void performDelete(review.feed!) : review?.kind === 'drafts' ? void performCheck(review.feed!, 'drafts') : review?.kind === 'posts' ? void performCheck(review.feed!, 'posts') : void performSave()}>{busy ? t('working') : reviewAction}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`feed-review-error:${notice.key}`}>{notice.text}</RouteNotice>}
      {review && <label className={styles.confirmLabel}>{confirmParts[0]}<code>{wordFor(review)}</code>{confirmParts[1]}<input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
    </Dialog>

    <Dialog open={Boolean(checked)} title={checked ? t('resultsTitle', { name: checked.feed.name }) : ''} description={checked?.result.notModified ? t('resultsUnchanged') : t('resultsNew', { count: eligible })} onClose={() => setChecked(null)}
      actions={<><Button data-dialog-cancel onClick={() => setChecked(null)}>{t('close')}</Button>{canWrite && checked && eligible > 0 && <><Button onClick={() => { const f = checked.feed; setChecked(null); setConfirmation(''); setReview({ kind: 'drafts', feed: f }); }}>{t('createDraftsAction')}</Button>{checked.feed.targetIds.length > 0 && <Button variant="primary" onClick={() => { const f = checked.feed; setChecked(null); setConfirmation(''); setReview({ kind: 'posts', feed: f }); }}>{t('createPostsAction')}</Button>}</>}</>}>
      {checked && checked.result.held > 0 && <p>{t('reviewQueued', { count: checked.result.reviewerNotificationsQueued ?? 0 })}</p>}
      {checked && (checked.result.entries.length ? <ul className={styles.entries}>{checked.result.entries.map(e => <li key={e.guid}><strong>{e.title ?? e.guid}</strong><span className={styles.meta}>{t(e.eligible ? 'resultNew' : e.isNew ? 'resultOlder' : 'resultSeen')}</span><details><summary>{t('entryPreview')}</summary><p className={styles.reviewPreview}>{e.message || t('previewEmpty')}</p>{e.link && /^https?:\/\//i.test(e.link) && <a href={e.link} target="_blank" rel="noopener noreferrer">{t('entryLink')}</a>}</details></li>)}</ul> : <p className={styles.empty}>{t('resultsNone')}</p>)}
      {checked?.result.backlog && <p className={styles.help}>{t('resultsBacklog')}</p>}
      {checked && checked.result.destinations === 0 && <p className={styles.help}>{t('resultsNoChannels')} {t('resultsNoChannelsPosts')}</p>}
    </Dialog>
  </div>;
}
