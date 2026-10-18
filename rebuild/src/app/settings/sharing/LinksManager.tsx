'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { Status } from '../_components';
import styles from './sharing.module.css';

type Kind = 'review' | 'calendar' | 'portal';
type Link = { id: string; kind: Kind; title: string; description: string | null; targetIds: string[]; daysBack: number; daysAhead: number; allowComments: boolean; decides: boolean; status: 'active' | 'expired' | 'revoked'; expiresAt: string | null; createdAt: string; feedbackCount: number; version: string };
type Feedback = { id: string; decision: 'approved' | 'rejected' | 'comment'; comment: string | null; authorName: string; createdAt: string; postStatus: string | null; postPreview: string | null };
type Props = {
  initial: { links: Link[]; page: number; hasMore: boolean }; channels: Array<{ id: string; name: string }>; canApprove: boolean;
  /** maxDaysBack, maxDaysAhead and maxTargets are optional host hints; the service enforces the real Root bounds either way. */
  limits: { titleMax: number; descriptionMax: number; defaultExpiryDays: number; maxExpiryDays: number; maxDaysBack?: number; maxDaysAhead?: number; maxTargets?: number };
};
type Draft = { kind: Kind; title: string; description: string; selected: string[]; allowComments: boolean; decides: boolean; daysBack: string; daysAhead: string; lifetime: string };
type Editor = { mode: 'create' } | { mode: 'edit'; link: Link };
type Pending = { link: Link; action: 'revoke' | 'rotate' | 'delete' };

const KIND = { review: 'Review', calendar: 'Calendar', portal: 'Client portal' } as const;
const ANSWER = { approved: 'Approved', rejected: 'Requested changes', comment: 'Commented' } as const;
const POST_STATUS: Record<string, string> = { pending_approval: 'Still waiting for review', scheduled: 'Scheduled', draft: 'Draft', rejected: 'Rejected', published: 'Published', failed: 'Failed', partially_failed: 'Partly failed' };
const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : 'No expiry set';
const stamp = (value: string) => new Date(value).toLocaleString();
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));
const CONSEQUENCE = {
  rotate: 'The current address stops working immediately. You get a new one to send.',
  revoke: 'The address stops opening immediately and cannot be switched back on. Feedback already given is kept.',
  delete: 'Deletes the link and all feedback recorded through it. Posts are not changed.',
} as const;
const EMPTY: Draft = { kind: 'review', title: '', description: '', selected: [], allowComments: true, decides: false, daysBack: '7', daysAhead: '30', lifetime: '' };

class ApiError extends Error { constructor(message: string, readonly code: string) { super(message); } }
async function call(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, ...(init.body ? { headers: { 'content-type': 'application/json' } } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof result.error === 'string' ? result.error : 'The change could not be confirmed. Refresh before trying again.', typeof result.code === 'string' ? result.code : 'unknown');
  return result;
}

export function LinksManager({ initial, channels, limits, canApprove }: Props) {
  const [links, setLinks] = useState(initial.links); const [page, setPage] = useState(initial.page); const [hasMore, setHasMore] = useState(initial.hasMore);
  const [editor, setEditor] = useState<Editor | null>(null); const [draft, setDraft] = useState<Draft>(EMPTY); const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [failed, setFailed] = useState(false);
  const [dialogError, setDialogError] = useState(''); const [stale, setStale] = useState(false);
  const [secret, setSecret] = useState<{ url: string; title: string; replaced: boolean } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<Link | null>(null); const [feedback, setFeedback] = useState<Feedback[]>([]); const [feedbackPage, setFeedbackPage] = useState(1); const [feedbackMore, setFeedbackMore] = useState(false); const [feedbackState, setFeedbackState] = useState<'idle' | 'loading' | 'error'>('idle');
  const inFlight = useRef(false);
  const channelIds = channels.map(channel => channel.id);
  const edited = editor?.mode === 'edit' ? editor.link : null;
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));

  async function guarded(work: () => Promise<void>, report: (text: string, cause?: unknown) => void) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage(''); setFailed(false); setDialogError(''); setStale(false);
    try { await work(); } catch (cause) { report(cause instanceof Error ? cause.message : 'The change could not be confirmed.', cause); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function load(next: number) { const result = await call(`/api/sharing/links?page=${next}`) as unknown as { links: Link[]; page: number; hasMore: boolean }; setLinks(result.links); setPage(result.page); setHasMore(result.hasMore); return result.links; }
  const pageFailure = (text: string) => { setFailed(true); setMessage(text); };
  const dialogFailure = (text: string, cause?: unknown) => { setDialogError(text); setStale(cause instanceof ApiError && cause.code === 'conflict'); };

  const openCreate = () => { setDraft(EMPTY); setAcknowledged(false); setDialogError(''); setStale(false); setEditor({ mode: 'create' }); };
  const openEdit = (link: Link) => {
    setDraft({ kind: link.kind, title: link.title, description: link.description ?? '', selected: link.targetIds.filter(id => channelIds.includes(id)), allowComments: link.allowComments, decides: link.decides, daysBack: String(link.daysBack), daysAhead: String(link.daysAhead), lifetime: '' });
    setAcknowledged(false); setDialogError(''); setStale(false); setEditor({ mode: 'edit', link });
  };

  // What the edit would send. Mirrors the service: metadata keeps the address, anything about access replaces it.
  const revoked = edited?.status === 'revoked';
  const legacyAll = Boolean(edited && edited.targetIds.length === 0);
  const unavailable = edited ? edited.targetIds.filter(id => !channelIds.includes(id)).length : 0;
  // Channels the editor can show as ticked. A link keeps its other channels unless the ticked set is changed on purpose.
  const baseline = edited ? edited.targetIds.filter(id => channelIds.includes(id)) : [];
  const patch: Record<string, unknown> = {};
  if (edited) {
    if (draft.title.trim() !== edited.title) patch.title = draft.title.trim();
    if ((draft.description.trim() || null) !== edited.description) patch.description = draft.description.trim() || null;
    if (!revoked) {
      if (draft.kind !== edited.kind) patch.kind = draft.kind;
      if (draft.selected.length && !sameSet(draft.selected, baseline)) patch.targetIds = draft.selected;
      if (draft.kind !== 'review' && draft.daysBack !== '' && Number(draft.daysBack) !== edited.daysBack) patch.daysBack = Number(draft.daysBack);
      if (draft.kind !== 'review' && draft.daysAhead !== '' && Number(draft.daysAhead) !== edited.daysAhead) patch.daysAhead = Number(draft.daysAhead);
      if (draft.allowComments !== edited.allowComments) patch.allowComments = draft.allowComments;
      if (draft.kind !== 'calendar' && draft.decides !== edited.decides) patch.decides = draft.decides;
      if (draft.kind === 'calendar' && edited.decides) patch.decides = false;
      if (draft.lifetime !== '') patch.expiresInDays = Number(draft.lifetime);
    }
  }
  const metadataOnly = (key: string) => key === 'title' || key === 'description';
  const changesAccess = Object.keys(patch).some(key => !metadataOnly(key));
  const hasChange = Object.keys(patch).length > 0;
  // A new link needs an explicit tick; an edit may not untick everything, because nothing ticked must never read as "all".
  const needsChannel = editor?.mode === 'create' || (!revoked && baseline.length > 0);
  const canSubmit = !busy && Boolean(draft.title.trim()) && !(needsChannel && draft.selected.length === 0) && (editor?.mode === 'create' ? acknowledged : hasChange && (!changesAccess || acknowledged));

  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!editor || !canSubmit) return; void guarded(async () => {
    if (editor.mode === 'create') {
      const title = draft.title.trim();
      const result = await call('/api/sharing/links', { method: 'POST', body: JSON.stringify({
        kind: draft.kind, title, description: draft.description.trim() || null, targetIds: draft.selected, allowComments: draft.allowComments, decides: draft.kind !== 'calendar' && draft.decides,
        ...(draft.kind !== 'review' ? { daysBack: Number(draft.daysBack || 0), daysAhead: Number(draft.daysAhead || 1) } : {}), ...(draft.lifetime ? { expiresInDays: Number(draft.lifetime) } : {}),
        confirmation: `CREATE SHARE LINK ${title}` }) });
      if (typeof result.url !== 'string') throw new Error('The link was created but its address could not be shown. Revoke it and create another.');
      setSecret({ url: result.url, title, replaced: false }); setEditor(null);
      try { await load(1); } catch { setMessage('Link created. The list could not be refreshed: reload the page to see it.'); }
      return;
    }
    const link = editor.link;
    const result = await call(`/api/sharing/links/${encodeURIComponent(link.id)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, expectedVersion: link.version, ...(changesAccess ? { confirmation: `UPDATE SHARE LINK ${link.id}` } : {}) }) });
    if (result.rotated === true && typeof result.url !== 'string') throw new Error('The link was saved but its new address could not be shown. Rotate it to get a new one.');
    setEditor(null); if (typeof result.url === 'string') setSecret({ url: result.url, title: draft.title.trim() || link.title, replaced: true });
    setMessage(result.rotated === true ? 'Link saved. The previous address no longer works.' : 'Link saved. The address is unchanged.');
    try { await load(page); } catch { setMessage(text => `${text} The list could not be refreshed: reload the page.`); }
  }, dialogFailure); };

  /** After a conflict: discard the stale form and continue from what is stored now. */
  const reloadLatest = () => { if (!edited) return; void guarded(async () => {
    const fresh = (await load(page)).find(link => link.id === edited.id);
    if (!fresh) { setEditor(null); setMessage('This link no longer exists.'); setFailed(true); return; }
    openEdit(fresh);
  }, dialogFailure); };

  const act = () => { if (!pending || !acknowledged) return; const current = pending; void guarded(async () => {
    let revealed: { url: string; title: string; replaced: boolean } | null = null;
    const base = `/api/sharing/links/${encodeURIComponent(current.link.id)}`;
    if (current.action === 'delete') await call(base, { method: 'DELETE', body: JSON.stringify({ confirmation: `DELETE SHARE LINK ${current.link.id}` }) });
    else {
      const result = await call(base, { method: 'POST', body: JSON.stringify({ action: current.action, confirmation: `${current.action.toUpperCase()} SHARE LINK ${current.link.id}` }) });
      if (current.action === 'rotate') { if (typeof result.url !== 'string') throw new Error('The link was rotated but its new address could not be shown. Rotate it again.'); revealed = { url: result.url, title: current.link.title, replaced: true }; }
    }
    setPending(null); setAcknowledged(false); if (revealed) setSecret(revealed);
    setMessage(current.action === 'delete' ? 'Link and its feedback deleted.' : current.action === 'revoke' ? 'Link revoked. It no longer opens.' : 'Link rotated. The previous address no longer works.');
    try { await load(links.length === 1 && current.action === 'delete' && page > 1 ? page - 1 : page); } catch { setMessage(text => `${text} The list could not be refreshed: reload the page.`); }
  }, dialogFailure); };
  const openAction = (link: Link, action: Pending['action']) => { setPending({ link, action }); setAcknowledged(false); setDialogError(''); setStale(false); };

  async function openFeedback(link: Link, next = 1) {
    setFeedbackFor(link); setFeedbackState('loading');
    try {
      const result = await call(`/api/sharing/links/${encodeURIComponent(link.id)}/feedback?page=${next}`) as unknown as { feedback: Feedback[]; page: number; hasMore: boolean };
      setFeedback(next === 1 ? result.feedback : [...feedback, ...result.feedback]); setFeedbackPage(result.page); setFeedbackMore(result.hasMore); setFeedbackState('idle');
    } catch { setFeedbackState('error'); }
  }

  const copy = () => { if (secret) void navigator.clipboard?.writeText(secret.url).then(() => { setFailed(false); setMessage('Address copied.'); }, () => { setFailed(true); setMessage('Copy failed. Select the address and copy it manually.'); }); };
  const scope = (link: Link) => link.targetIds.length ? plural(link.targetIds.length, 'channel') : 'all channels (older link)';
  const columns: TableColumn<Link>[] = [
    { key: 'title', label: 'Link', render: link => <><strong>{link.title}</strong><br /><small>{KIND[link.kind]}{link.decides ? ' · client can decide' : ''} · {scope(link)}</small></> },
    { key: 'status', label: 'Status', render: link => <Status tone={link.status === 'active' ? 'good' : 'neutral'}>{link.status === 'active' ? 'Active' : link.status === 'expired' ? 'Expired' : 'Revoked'}</Status> },
    { key: 'expires', label: 'Expires', render: link => date(link.expiresAt) },
    { key: 'feedback', label: 'Feedback', render: link => link.feedbackCount ? <Button size="sm" variant="quiet" onClick={() => { setFeedback([]); void openFeedback(link); }} aria-label={`View ${plural(link.feedbackCount, 'answer')} on ${link.title}`}>{plural(link.feedbackCount, 'answer')}</Button> : 'None yet' },
    { key: 'manage', label: 'Manage', render: link => <div className={styles.actions}>
      <Button size="sm" disabled={busy} onClick={() => openEdit(link)} aria-label={`Edit ${link.title}`}>Edit</Button>
      {link.status === 'active' && <Button size="sm" disabled={busy} onClick={() => openAction(link, 'rotate')} aria-label={`Rotate ${link.title}`}>Rotate</Button>}
      {link.status !== 'revoked' && <Button size="sm" disabled={busy} onClick={() => openAction(link, 'revoke')} aria-label={`Revoke ${link.title}`}>Revoke</Button>}
      <Button size="sm" variant="danger" disabled={busy} onClick={() => openAction(link, 'delete')} aria-label={`Delete ${link.title}`}>Delete</Button></div> },
  ];
  const close = () => { setEditor(null); setPending(null); };
  const creating = editor?.mode === 'create';
  const consequence = pending ? (pending.action === 'delete' ? `Deletes the link and ${pending.link.feedbackCount ? plural(pending.link.feedbackCount, 'answer') : 'any feedback'} recorded through it. Posts are not changed.` : CONSEQUENCE[pending.action]) : '';

  return <div className={styles.manager}>
    <div className={styles.actions}><Button variant="primary" disabled={busy} onClick={openCreate}>New share link</Button></div>
    {message && <p className={failed ? styles.error : styles.message} role={failed ? 'alert' : 'status'}>{message}</p>}
    <DataTable columns={columns} rows={links} rowKey={link => link.id} caption="Share links" emptyMessage="No share links yet. Create one to invite a client to review posts or see the calendar." />
    {(page > 1 || hasMore) && <div className={styles.actions}><Button size="sm" disabled={busy || page <= 1} onClick={() => void guarded(async () => { await load(page - 1); }, pageFailure)}>Previous page</Button><span className={styles.message}>Page {page}</span><Button size="sm" disabled={busy || !hasMore} onClick={() => void guarded(async () => { await load(page + 1); }, pageFailure)}>Next page</Button></div>}

    <Dialog open={Boolean(editor)} title={creating ? 'New share link' : `Edit “${edited?.title ?? ''}”`} description={creating ? 'Anyone with the address can open it without signing in. It shows only the channels you choose and expires.' : revoked ? 'This link is revoked and stays revoked. You can rename it; create a new link to share again.' : edited?.status === 'expired' ? 'This link has expired. Set a new lifetime below to switch it back on.' : 'Rename it freely. Changing what it shows or who can answer replaces its address.'} busy={busy} onClose={close}
      actions={<><Button variant="quiet" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" form="share-editor" variant="primary" disabled={!canSubmit}>{busy ? 'Working…' : creating ? 'Create link' : changesAccess ? 'Save and replace address' : 'Save changes'}</Button></>}>
      <form id="share-editor" className={styles.form} onSubmit={submit}>
        <div className={styles.row}>
          <label className={styles.field}><span>Type</span><select value={draft.kind} disabled={busy || revoked} onChange={event => set({ kind: event.target.value as Kind, ...(event.target.value === 'calendar' ? { decides: false } : {}) })}><option value="review">Review: posts waiting for feedback</option><option value="calendar">Calendar: what is planned and published</option><option value="portal">Portal: review and calendar together</option></select></label>
          <label className={styles.field}><span>Title</span><input required maxLength={limits.titleMax} disabled={busy} value={draft.title} onChange={event => set({ title: event.target.value })} /></label>
          <label className={styles.field}><span>{creating ? 'Lifetime in days' : 'Renew for (days)'}</span><input type="number" min={1} max={limits.maxExpiryDays} inputMode="numeric" disabled={busy || revoked} value={draft.lifetime} onChange={event => set({ lifetime: event.target.value })} placeholder={creating ? `${limits.defaultExpiryDays} (default)` : 'Keep current'} /><small>{creating ? `Up to ${limits.maxExpiryDays} days.` : `Counts from today, up to ${limits.maxExpiryDays} days.${edited?.expiresAt ? ` Now expires ${date(edited.expiresAt)}.` : ''}`}</small></label>
        </div>
        <label className={styles.field}><span>Message for the client (optional)</span><textarea rows={2} maxLength={limits.descriptionMax} disabled={busy} value={draft.description} onChange={event => set({ description: event.target.value })} /></label>
        {draft.kind !== 'review' && <div className={styles.row}>
          <label className={styles.field}><span>Days back shown</span><input type="number" min={0} max={limits.maxDaysBack} inputMode="numeric" disabled={busy || revoked} value={draft.daysBack} onChange={event => set({ daysBack: event.target.value })} /></label>
          <label className={styles.field}><span>Days ahead shown</span><input type="number" min={1} max={limits.maxDaysAhead} inputMode="numeric" disabled={busy || revoked} value={draft.daysAhead} onChange={event => set({ daysAhead: event.target.value })} /></label>
        </div>}
        <fieldset className={styles.field} disabled={busy || revoked}><legend>Channels shown</legend>
          {channels.length ? <>
            <div className={styles.actions}><Button size="sm" onClick={() => set({ selected: limits.maxTargets ? channelIds.slice(0, limits.maxTargets) : channelIds })} disabled={busy || revoked}>Select all</Button><Button size="sm" variant="quiet" onClick={() => set({ selected: [] })} disabled={busy || revoked || !draft.selected.length}>Clear</Button><span className={styles.message}>{draft.selected.length} of {channels.length} selected</span></div>
            <div className={styles.channels}>{channels.map(channel => <label key={channel.id} className={styles.check}><input type="checkbox" checked={draft.selected.includes(channel.id)} onChange={event => set({ selected: event.target.checked ? [...draft.selected, channel.id] : draft.selected.filter(id => id !== channel.id) })} /><span>{channel.name}</span></label>)}</div></>
            : <p className={styles.empty}>No channels are available to share. Select channels in Settings first.</p>}
          <small>{legacyAll ? 'This older link shows every channel. Choose channels to limit it, or leave all unchecked to keep it as it is.' : 'Tick every channel this link may show. Nothing ticked means nothing is shared.'}</small>
          {unavailable > 0 && <small>{plural(unavailable, 'channel')} on this link {unavailable === 1 ? 'is' : 'are'} no longer available and will be dropped if you change the ticked channels.</small>}</fieldset>
        <label className={styles.check}><input type="checkbox" disabled={busy || revoked} checked={draft.allowComments} onChange={event => set({ allowComments: event.target.checked })} /><span>Let visitors leave comments</span></label>
        {draft.kind !== 'calendar' && <label className={styles.check}><input type="checkbox" disabled={busy || revoked || (!canApprove && !draft.decides)} checked={draft.decides} onChange={event => set({ decides: event.target.checked })} /><span>Their approval or change request settles the post in your review queue{canApprove ? '' : ' (needs approval permission)'}</span></label>}
        {!creating && changesAccess && <p className={styles.warning} role="status">These changes replace the link’s address. The old address and any page already open with it stop working immediately; you will get a new address to send.</p>}
        {(creating || changesAccess) && <label className={styles.check}><input type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{creating ? 'I understand that anyone who has the address can open this link without signing in until it expires or I revoke it.' : 'I understand the old address will stop working and I must send the new one.'}</span></label>}
        {dialogError && <div className={styles.confirm}><p className={styles.error} role="alert">{dialogError}</p>{stale && <><small>Your entries are kept above until you reload.</small><Button size="sm" disabled={busy} onClick={reloadLatest}>Reload latest and discard my changes</Button></>}</div>}
      </form>
    </Dialog>

    <Dialog open={Boolean(pending)} title={pending ? `${pending.action[0]!.toUpperCase()}${pending.action.slice(1)} “${pending.link.title}”` : ''} description={consequence} busy={busy} onClose={close}
      actions={pending && <><Button variant="quiet" disabled={busy} onClick={close}>Cancel</Button><Button variant={pending.action === 'delete' ? 'danger' : 'primary'} disabled={busy || !acknowledged} onClick={act}>{busy ? 'Working…' : `Confirm ${pending.action}`}</Button></>}>
      {pending && <div className={styles.form}>
        <label className={styles.check}><input type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{pending.action === 'rotate' ? 'I understand the current address stops working immediately.' : pending.action === 'revoke' ? 'I understand the address stops opening immediately and this cannot be undone.' : `I understand this permanently deletes the link${pending.link.feedbackCount ? ` and ${plural(pending.link.feedbackCount, 'answer')}` : ''}.`}</span></label>
        {dialogError && <p className={styles.error} role="alert">{dialogError}</p>}</div>}
    </Dialog>

    <Dialog open={Boolean(secret)} title={secret?.replaced ? 'Copy the new address now' : 'Copy the address now'} description={`For security this address is shown only once. Anyone who has it can open the link until it expires or you revoke it.${secret?.replaced ? ' The previous address no longer works.' : ''}`} onClose={() => setSecret(null)}
      actions={<><Button onClick={copy}>Copy address</Button><Button variant="primary" onClick={() => setSecret(null)}>I have copied it</Button></>}>
      {secret && <div className={styles.secret}><strong>{secret.title}</strong><code>{secret.url}</code></div>}
    </Dialog>

    <Dialog open={Boolean(feedbackFor)} title={feedbackFor ? `Answers on “${feedbackFor.title}”` : ''} description="What clients answered, and where each post stands now. Approval changes appear only when the post status says so." onClose={() => { setFeedbackFor(null); setFeedback([]); }}
      actions={<Button variant="quiet" onClick={() => { setFeedbackFor(null); setFeedback([]); }}>Close</Button>}>
      {feedbackState === 'loading' && !feedback.length && <p className={styles.message} role="status">Loading answers…</p>}
      {feedbackState === 'error' && <div className={styles.confirm}><p className={styles.error} role="alert">Answers could not be loaded.</p><Button size="sm" onClick={() => feedbackFor && void openFeedback(feedbackFor, feedback.length ? feedbackPage + 1 : 1)}>Try again</Button></div>}
      {feedbackState === 'idle' && !feedback.length && <p className={styles.empty}>No answers yet.</p>}
      <ul className={styles.feedbackList}>{feedback.map(item => <li key={item.id}>
        <p><strong>{item.authorName}</strong> · {ANSWER[item.decision]} · <small>{stamp(item.createdAt)}</small></p>
        {item.comment && <p className={styles.quote}>{item.comment}</p>}
        <small>{item.postPreview ? `Post: “${item.postPreview}”` : 'Post details are not shown: the post may have been deleted, or your role or plan cannot read Publishing.'}{item.postStatus ? ` · Now: ${POST_STATUS[item.postStatus] ?? item.postStatus}` : ''}</small>
      </li>)}</ul>
      {feedbackMore && feedbackState === 'idle' && feedbackFor && <Button size="sm" onClick={() => void openFeedback(feedbackFor, feedbackPage + 1)}>Show more</Button>}
    </Dialog>
  </div>;
}
