'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { Status } from '@/modules/settings/ui/_components';
import { ownerText, resolveOwnerCopy } from '../owner-copy';
import styles from './sharing.module.css';

type Kind = 'review' | 'calendar' | 'portal';
type Link = { id: string; kind: Kind; title: string; description: string | null; targetIds: string[]; daysBack: number; daysAhead: number; allowComments: boolean; decides: boolean; status: 'active' | 'expired' | 'revoked'; expiresAt: string | null; createdAt: string; feedbackCount: number; version: string };
type Feedback = { id: string; decision: 'approved' | 'rejected' | 'comment'; comment: string | null; authorName: string; createdAt: string; postStatus: string | null; postPreview: string | null };
type Props = {
  initial: { presentation?: { workspaceName: string | null; workspaceLogoUrl: string | null; advisoryDecisionNotificationsEnabled: boolean }; links: Link[]; page: number; hasMore: boolean }; channels: Array<{ id: string; name: string }>; canApprove: boolean;
  /** maxDaysBack, maxDaysAhead and maxTargets are optional host hints; the service enforces the real Root bounds either way. */
  limits: { titleMax: number; descriptionMax: number; defaultExpiryDays: number; maxExpiryDays: number; maxDaysBack?: number; maxDaysAhead?: number; maxTargets?: number };
  /** Phrase → text in the viewer's language (see `owner-copy.ts`); English when the host does not supply it. */
  copy?: Record<string, string>;
};
type Draft = { kind: Kind; title: string; description: string; selected: string[]; allowComments: boolean; decides: boolean; daysBack: string; daysAhead: string; lifetime: string };
type Editor = { mode: 'create' } | { mode: 'edit'; link: Link };
type Pending = { link: Link; action: 'revoke' | 'rotate' | 'delete' };

const stamp = (value: string) => new Date(value).toLocaleString();
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));
const DEFAULT_COPY = resolveOwnerCopy('en');
const EMPTY: Draft = { kind: 'review', title: '', description: '', selected: [], allowComments: true, decides: false, daysBack: '7', daysAhead: '30', lifetime: '' };

class ApiError extends Error { constructor(message: string, readonly code: string) { super(message); } }
async function call(url: string, init: RequestInit = {}, fallback = ''): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, ...(init.body ? { headers: { 'content-type': 'application/json' } } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof result.error === 'string' ? result.error : fallback, typeof result.code === 'string' ? result.code : 'unknown');
  return result;
}

export function LinksManager({ initial, channels, limits, canApprove, copy = DEFAULT_COPY }: Props) {
  const t = ownerText(copy);
  const kindLabel = (kind: Kind) => kind === 'review' ? t('Review') : kind === 'calendar' ? t('Calendar') : t('Client portal');
  const answerLabel = (decision: Feedback['decision']) => decision === 'approved' ? t('Approved') : decision === 'rejected' ? t('Requested changes') : t('Commented');
  const postStatus = (status: string) => ({ pending_approval: t('Still waiting for review'), scheduled: t('Scheduled'), draft: t('Draft'), rejected: t('Rejected'), published: t('Published'), failed: t('Failed'), partially_failed: t('Partly failed') } as Record<string, string>)[status] ?? status;
  const channelCount = (count: number) => count === 1 ? t('{0} channel', count) : t('{0} channels', count);
  const answerCount = (count: number) => count === 1 ? t('{0} answer', count) : t('{0} answers', count);
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : t('No expiry set');
  const unconfirmed = t('The change could not be confirmed. Refresh before trying again.');
  const request = (url: string, init: RequestInit = {}) => call(url, init, unconfirmed);
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
    try { await work(); } catch (cause) { report(cause instanceof Error ? cause.message : t('The change could not be confirmed.'), cause); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function load(next: number) { const result = await request(`/api/sharing/links?page=${next}`) as unknown as { links: Link[]; page: number; hasMore: boolean }; setLinks(result.links); setPage(result.page); setHasMore(result.hasMore); return result.links; }
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
  const canSubmit = !busy && Boolean(draft.title.trim()) && !(needsChannel && draft.selected.length === 0) && (editor?.mode === 'create' ? acknowledged : hasChange && acknowledged);

  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!editor || !canSubmit) return; void guarded(async () => {
    if (editor.mode === 'create') {
      const title = draft.title.trim();
      const result = await request('/api/sharing/links', { method: 'POST', body: JSON.stringify({
        kind: draft.kind, title, description: draft.description.trim() || null, targetIds: draft.selected, allowComments: draft.allowComments, decides: draft.kind !== 'calendar' && draft.decides,
        ...(draft.kind !== 'review' ? { daysBack: Number(draft.daysBack || 0), daysAhead: Number(draft.daysAhead || 1) } : {}), ...(draft.lifetime ? { expiresInDays: Number(draft.lifetime) } : {}),
        confirmation: `CREATE SHARE LINK ${title}` }) });
      if (typeof result.url !== 'string') throw new Error(t('The link was created but its address could not be shown. Revoke it and create another.'));
      setSecret({ url: result.url, title, replaced: false }); setEditor(null);
      try { await load(1); } catch { setMessage(t('Link created. The list could not be refreshed: reload the page to see it.')); }
      return;
    }
    const link = editor.link;
    const result = await request(`/api/sharing/links/${encodeURIComponent(link.id)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, expectedVersion: link.version, confirmation: `UPDATE SHARE LINK ${link.id}` }) });
    if (result.rotated === true && typeof result.url !== 'string') throw new Error(t('The link was saved but its new address could not be shown. Rotate it to get a new one.'));
    setEditor(null); if (typeof result.url === 'string') setSecret({ url: result.url, title: draft.title.trim() || link.title, replaced: true });
    setMessage(result.rotated === true ? t('Link saved. The previous address no longer works.') : t('Link saved. The address is unchanged.'));
    try { await load(page); } catch { setMessage(text => `${text}${t(' The list could not be refreshed: reload the page.')}`); }
  }, dialogFailure); };

  /** After a conflict: discard the stale form and continue from what is stored now. */
  const reloadLatest = () => { if (!edited) return; void guarded(async () => {
    const fresh = (await load(page)).find(link => link.id === edited.id);
    if (!fresh) { setEditor(null); setMessage(t('This link no longer exists.')); setFailed(true); return; }
    openEdit(fresh);
  }, dialogFailure); };

  const act = () => { if (!pending || !acknowledged) return; const current = pending; void guarded(async () => {
    let revealed: { url: string; title: string; replaced: boolean } | null = null;
    const base = `/api/sharing/links/${encodeURIComponent(current.link.id)}`;
    if (current.action === 'delete') await request(base, { method: 'DELETE', body: JSON.stringify({ confirmation: `DELETE SHARE LINK ${current.link.id}` }) });
    else {
      const result = await request(base, { method: 'POST', body: JSON.stringify({ action: current.action, confirmation: `${current.action.toUpperCase()} SHARE LINK ${current.link.id}` }) });
      if (current.action === 'rotate') { if (typeof result.url !== 'string') throw new Error(t('The link was rotated but its new address could not be shown. Rotate it again.')); revealed = { url: result.url, title: current.link.title, replaced: true }; }
    }
    setPending(null); setAcknowledged(false); if (revealed) setSecret(revealed);
    setMessage(current.action === 'delete' ? t('Link and its feedback deleted.') : current.action === 'revoke' ? t('Link revoked. It no longer opens.') : t('Link rotated. The previous address no longer works.'));
    try { await load(links.length === 1 && current.action === 'delete' && page > 1 ? page - 1 : page); } catch { setMessage(text => `${text}${t(' The list could not be refreshed: reload the page.')}`); }
  }, dialogFailure); };
  const openAction = (link: Link, action: Pending['action']) => { setPending({ link, action }); setAcknowledged(false); setDialogError(''); setStale(false); };

  async function openFeedback(link: Link, next = 1) {
    setFeedbackFor(link); setFeedbackState('loading');
    try {
      const result = await request(`/api/sharing/links/${encodeURIComponent(link.id)}/feedback?page=${next}`) as unknown as { feedback: Feedback[]; page: number; hasMore: boolean };
      setFeedback(next === 1 ? result.feedback : [...feedback, ...result.feedback]); setFeedbackPage(result.page); setFeedbackMore(result.hasMore); setFeedbackState('idle');
    } catch { setFeedbackState('error'); }
  }

  const copyAddress = () => { if (secret) void navigator.clipboard?.writeText(secret.url).then(() => { setFailed(false); setMessage(t('Address copied.')); }, () => { setFailed(true); setMessage(t('Copy failed. Select the address and copy it manually.')); }); };
  const scope = (link: Link) => link.targetIds.length ? channelCount(link.targetIds.length) : t('all channels (older link)');
  const columns: TableColumn<Link>[] = [
    { key: 'title', label: t('Link'), render: link => <><strong>{link.title}</strong><br /><small>{kindLabel(link.kind)}{link.decides ? t(' · client can decide') : ''} · {scope(link)}</small></> },
    { key: 'status', label: t('Status'), render: link => <Status tone={link.status === 'active' ? 'good' : 'neutral'}>{link.status === 'active' ? t('Active') : link.status === 'expired' ? t('Expired') : t('Revoked')}</Status> },
    { key: 'expires', label: t('Expires'), render: link => date(link.expiresAt) },
    { key: 'feedback', label: t('Feedback'), render: link => link.feedbackCount ? <Button size="sm" variant="quiet" onClick={() => { setFeedback([]); void openFeedback(link); }} aria-label={t('View {0} on {1}', answerCount(link.feedbackCount), link.title)}>{answerCount(link.feedbackCount)}</Button> : t('None yet') },
    { key: 'manage', label: t('Manage'), render: link => <div className={styles.actions}>
      <Button size="sm" disabled={busy} onClick={() => openEdit(link)} aria-label={t('Edit {0}', link.title)}>{t('Edit')}</Button>
      {link.status === 'active' && <Button size="sm" disabled={busy} onClick={() => openAction(link, 'rotate')} aria-label={t('Rotate {0}', link.title)}>{t('Rotate')}</Button>}
      {link.status !== 'revoked' && <Button size="sm" disabled={busy} onClick={() => openAction(link, 'revoke')} aria-label={t('Revoke {0}', link.title)}>{t('Revoke')}</Button>}
      <Button size="sm" variant="danger" disabled={busy} onClick={() => openAction(link, 'delete')} aria-label={t('Delete {0}', link.title)}>{t('Delete')}</Button></div> },
  ];
  const close = () => { setEditor(null); setPending(null); };
  const creating = editor?.mode === 'create';
  const consequence = pending ? (pending.action === 'delete' ? (pending.link.feedbackCount ? t('Deletes the link and {0} recorded through it. Posts are not changed.', answerCount(pending.link.feedbackCount)) : t('Deletes the link and any feedback recorded through it. Posts are not changed.')) : pending.action === 'rotate' ? t('The current address stops working immediately. You get a new one to send.') : t('The address stops opening immediately and cannot be switched back on. Feedback already given is kept.')) : '';
  const actionTitle = (action: Pending['action'], title: string) => action === 'delete' ? t('Delete “{0}”', title) : action === 'rotate' ? t('Rotate “{0}”', title) : t('Revoke “{0}”', title);
  const actionConfirm = (action: Pending['action']) => action === 'delete' ? t('Confirm delete') : action === 'rotate' ? t('Confirm rotate') : t('Confirm revoke');
  const forgetFeedback = () => { setFeedbackFor(null); setFeedback([]); };

  return <div className={styles.manager}>
    <div className={styles.actions}><Button variant="primary" disabled={busy} onClick={openCreate}>{t('New share link')}</Button></div>
    {message && <p className={failed ? styles.error : styles.message} role={failed ? 'alert' : 'status'}>{message}</p>}
    {initial.presentation?.advisoryDecisionNotificationsEnabled && <p className={styles.message}>{t('When the team makes the final decision, client answers can notify the post author. Email follows their preferences; comments stay in Feedback.')}</p>}
    <DataTable columns={columns} rows={links} rowKey={link => link.id} caption={t('Share links')} emptyMessage={t('No share links yet. Create one to invite a client to review posts or see the calendar.')} />
    {(page > 1 || hasMore) && <div className={styles.actions}><Button size="sm" disabled={busy || page <= 1} onClick={() => void guarded(async () => { await load(page - 1); }, pageFailure)}>{t('Previous page')}</Button><span className={styles.message}>{t('Page {0}', page)}</span><Button size="sm" disabled={busy || !hasMore} onClick={() => void guarded(async () => { await load(page + 1); }, pageFailure)}>{t('Next page')}</Button></div>}

    <Dialog open={Boolean(editor)} title={creating ? t('New share link') : t('Edit “{0}”', edited?.title ?? '')} description={creating ? t('Anyone with the address can open it without signing in. It shows only the channels you choose and expires.') : revoked ? t('This link is revoked and stays revoked. You can rename it; create a new link to share again.') : edited?.status === 'expired' ? t('This link has expired. Set a new lifetime below to switch it back on.') : t('Rename it freely. Changing what it shows or who can answer replaces its address.')} busy={busy} onClose={close}
      actions={<><Button variant="quiet" disabled={busy} onClick={close}>{t('Cancel')}</Button><Button type="submit" form="share-editor" variant="primary" disabled={!canSubmit}>{busy ? t('Working…') : creating ? t('Create link') : changesAccess ? t('Save and replace address') : t('Save changes')}</Button></>}>
      <form id="share-editor" className={styles.form} onSubmit={submit}>
        <div className={styles.row}>
          <label className={styles.field}><span>{t('Type')}</span><select value={draft.kind} disabled={busy || revoked} onChange={event => set({ kind: event.target.value as Kind, ...(event.target.value === 'calendar' ? { decides: false } : {}) })}><option value="review">{t('Review: posts waiting for feedback')}</option><option value="calendar">{t('Calendar: what is planned and published')}</option><option value="portal">{t('Portal: review and calendar together')}</option></select></label>
          <label className={styles.field}><span>{t('Title')}</span><input required maxLength={limits.titleMax} disabled={busy} value={draft.title} onChange={event => set({ title: event.target.value })} /></label>
          <label className={styles.field}><span>{creating ? t('Lifetime in days') : t('Renew for (days)')}</span><input type="number" min={1} max={limits.maxExpiryDays} inputMode="numeric" disabled={busy || revoked} value={draft.lifetime} onChange={event => set({ lifetime: event.target.value })} placeholder={creating ? t('{0} (default)', limits.defaultExpiryDays) : t('Keep current')} /><small>{creating ? t('Up to {0} days.', limits.maxExpiryDays) : `${t('Counts from today, up to {0} days.', limits.maxExpiryDays)}${edited?.expiresAt ? ` ${t('Now expires {0}.', date(edited.expiresAt))}` : ''}`}</small></label>
        </div>
        <label className={styles.field}><span>{t('Message for the client (optional)')}</span><textarea rows={2} maxLength={limits.descriptionMax} disabled={busy} value={draft.description} onChange={event => set({ description: event.target.value })} /></label>
        {draft.kind !== 'review' && <div className={styles.row}>
          <label className={styles.field}><span>{t('Days back shown')}</span><input type="number" min={0} max={limits.maxDaysBack} inputMode="numeric" disabled={busy || revoked} value={draft.daysBack} onChange={event => set({ daysBack: event.target.value })} /></label>
          <label className={styles.field}><span>{t('Days ahead shown')}</span><input type="number" min={1} max={limits.maxDaysAhead} inputMode="numeric" disabled={busy || revoked} value={draft.daysAhead} onChange={event => set({ daysAhead: event.target.value })} /></label>
        </div>}
        <fieldset className={styles.field} disabled={busy || revoked}><legend>{t('Channels shown')}</legend>
          {channels.length ? <>
            <div className={styles.actions}><Button size="sm" onClick={() => set({ selected: limits.maxTargets ? channelIds.slice(0, limits.maxTargets) : channelIds })} disabled={busy || revoked}>{t('Select all')}</Button><Button size="sm" variant="quiet" onClick={() => set({ selected: [] })} disabled={busy || revoked || !draft.selected.length}>{t('Clear')}</Button><span className={styles.message}>{t('{0} of {1} selected', draft.selected.length, channels.length)}</span></div>
            <div className={styles.channels}>{channels.map(channel => <label key={channel.id} className={styles.check}><input type="checkbox" checked={draft.selected.includes(channel.id)} onChange={event => set({ selected: event.target.checked ? [...draft.selected, channel.id] : draft.selected.filter(id => id !== channel.id) })} /><span>{channel.name}</span></label>)}</div></>
            : <p className={styles.empty}>{t('No channels are available to share. Select channels in Settings first.')}</p>}
          <small>{legacyAll ? t('This older link shows every channel. Choose channels to limit it, or leave all unchecked to keep it as it is.') : t('Tick every channel this link may show. Nothing ticked means nothing is shared.')}</small>
          {unavailable > 0 && <small>{unavailable === 1 ? t('{0} on this link is no longer available and will be dropped if you change the ticked channels.', channelCount(unavailable)) : t('{0} on this link are no longer available and will be dropped if you change the ticked channels.', channelCount(unavailable))}</small>}</fieldset>
        <label className={styles.check}><input type="checkbox" disabled={busy || revoked} checked={draft.allowComments} onChange={event => set({ allowComments: event.target.checked })} /><span>{t('Let visitors leave comments')}</span></label>
        {draft.kind !== 'calendar' && <label className={styles.check}><input type="checkbox" disabled={busy || revoked || (!canApprove && !draft.decides)} checked={draft.decides} onChange={event => set({ decides: event.target.checked })} /><span>{canApprove ? t('Their approval or change request settles the post in your review queue') : t('Their approval or change request settles the post in your review queue (needs approval permission)')}</span></label>}
        {!creating && changesAccess && <p className={styles.warning} role="status">{t('These changes replace the link’s address. The old address and any page already open with it stop working immediately; you will get a new address to send.')}</p>}
        {(creating || hasChange) && <label className={styles.check}><input type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{creating ? t('I understand that anyone who has the address can open this link without signing in until it expires or I revoke it.') : changesAccess ? t('I understand the old address will stop working and I must send the new one.') : t('I confirm these changes. The address stays the same.')}</span></label>}
        {dialogError && <div className={styles.confirm}><p className={styles.error} role="alert">{dialogError}</p>{stale && <><small>{t('Your entries are kept above until you reload.')}</small><Button size="sm" disabled={busy} onClick={reloadLatest}>{t('Reload latest and discard my changes')}</Button></>}</div>}
      </form>
    </Dialog>

    <Dialog open={Boolean(pending)} title={pending ? actionTitle(pending.action, pending.link.title) : ''} description={consequence} busy={busy} onClose={close}
      actions={pending && <><Button variant="quiet" disabled={busy} onClick={close}>{t('Cancel')}</Button><Button variant={pending.action === 'delete' ? 'danger' : 'primary'} disabled={busy || !acknowledged} onClick={act}>{busy ? t('Working…') : actionConfirm(pending.action)}</Button></>}>
      {pending && <div className={styles.form}>
        <label className={styles.check}><input type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{pending.action === 'rotate' ? t('I understand the current address stops working immediately.') : pending.action === 'revoke' ? t('I understand the address stops opening immediately and this cannot be undone.') : pending.link.feedbackCount ? t('I understand this permanently deletes the link and {0}.', answerCount(pending.link.feedbackCount)) : t('I understand this permanently deletes the link.')}</span></label>
        {dialogError && <p className={styles.error} role="alert">{dialogError}</p>}</div>}
    </Dialog>

    <Dialog open={Boolean(secret)} title={secret?.replaced ? t('Copy the new address now') : t('Copy the address now')} description={secret?.replaced ? t('For security this address is shown only once. Anyone who has it can open the link until it expires or you revoke it. The previous address no longer works.') : t('For security this address is shown only once. Anyone who has it can open the link until it expires or you revoke it.')} onClose={() => setSecret(null)}
      actions={<><Button onClick={copyAddress}>{t('Copy address')}</Button><Button variant="primary" onClick={() => setSecret(null)}>{t('I have copied it')}</Button></>}>
      {secret && <div className={styles.secret}><strong>{secret.title}</strong><code>{secret.url}</code></div>}
    </Dialog>

    <Dialog open={Boolean(feedbackFor)} title={feedbackFor ? t('Answers on “{0}”', feedbackFor.title) : ''} description={t('What clients answered, and where each post stands now. Approval changes appear only when the post status says so.')} onClose={forgetFeedback}
      actions={<Button variant="quiet" onClick={forgetFeedback}>{t('Close')}</Button>}>
      {feedbackState === 'loading' && !feedback.length && <p className={styles.message} role="status">{t('Loading answers…')}</p>}
      {feedbackState === 'error' && <div className={styles.confirm}><p className={styles.error} role="alert">{t('Answers could not be loaded.')}</p><Button size="sm" onClick={() => feedbackFor && void openFeedback(feedbackFor, feedback.length ? feedbackPage + 1 : 1)}>{t('Try again')}</Button></div>}
      {feedbackState === 'idle' && !feedback.length && <p className={styles.empty}>{t('No answers yet.')}</p>}
      <ul className={styles.feedbackList}>{feedback.map(item => <li key={item.id}>
        <p><strong>{item.authorName}</strong> · {answerLabel(item.decision)} · <small>{stamp(item.createdAt)}</small></p>
        {item.comment && <p className={styles.quote}>{item.comment}</p>}
        <small>{item.postPreview ? t('Post: “{0}”', item.postPreview) : t('Post details are not shown: the post may have been deleted, or your role or plan cannot read Publishing.')}{item.postStatus ? t(' · Now: {0}', postStatus(item.postStatus)) : ''}</small>
      </li>)}</ul>
      {feedbackMore && feedbackState === 'idle' && feedbackFor && <Button size="sm" onClick={() => void openFeedback(feedbackFor, feedbackPage + 1)}>{t('Show more')}</Button>}
    </Dialog>
  </div>;
}
