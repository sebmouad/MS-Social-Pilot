'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { RouteNotice } from '@/components/RouteNotice';
import { SidebarDock } from '@/components/SidebarDock';
import type { NotificationPage, NotificationPreferenceView, NotificationRow } from '@/modules/settings/notifications/server';
import styles from './notifications.module.css';

type Notice = { message: string; error: boolean; key: number } | null;
type Action = { kind: 'read' | 'delete'; item: NotificationRow } | null;
type EmailPrefs = Pick<NotificationPreferenceView['preferences'], 'onNoteMention' | 'onQueueEmpty'>;

const UPDATE_CONFIRMATION = 'UPDATE NOTIFICATION PREFERENCES';
const eventName = (kind: NotificationRow['kind']) => kind === 'note_mention' ? 'Teammate note mention' : 'Content mix needs attention';
const emailOutcome = (state: NotificationRow['emailState']) => {
  switch (state) {
    case 'sent': return 'Email sent';
    case 'pending': return 'Email pending';
    case 'sending': return 'Email sending';
    case 'uncertain': return 'Email outcome needs review';
    case 'failed': return 'Email could not be sent';
    case 'cancelled': return 'Email canceled';
    default: return 'Email status unavailable';
  }
};

export function NotificationCenter({ initialPreferences, initialPage }: { initialPreferences: NotificationPreferenceView | null; initialPage: NotificationPage | null }) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [rows, setRows] = useState(initialPage?.items ?? []);
  const [page, setPage] = useState(initialPage?.page ?? 1);
  const [hasMore, setHasMore] = useState(initialPage?.hasMore ?? false);
  const [listLoaded, setListLoaded] = useState(initialPage !== null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [prefsDraft, setPrefsDraft] = useState<EmailPrefs>(initialPreferences?.preferences ?? { onNoteMention: false, onQueueEmpty: false });
  const [muteDraft, setMuteDraft] = useState<string[]>(initialPreferences?.mutes.map(mute => mute.targetId) ?? []);
  const [prefsChanged, setPrefsChanged] = useState(false);
  const [reviewPrefs, setReviewPrefs] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [nextKey, setNextKey] = useState(1);

  function announce(message: string, error = false) {
    setNotice({ message, error, key: nextKey });
    setNextKey(value => value + 1);
  }

  async function loadList(nextPage = page, nextUnreadOnly = unreadOnly) {
    setBusy(true);
    try {
      const query = new URLSearchParams({ page: String(nextPage) });
      if (nextUnreadOnly) query.set('unreadOnly', 'true');
      const response = await fetch(`/api/notifications?${query}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Notifications could not be loaded.');
      if (!Array.isArray(result.notifications?.items) || !Number.isInteger(result.notifications?.page) || typeof result.notifications?.hasMore !== 'boolean') throw new Error('Notifications could not be confirmed. Refresh and try again.');
      setRows(result.notifications.items.map((row: NotificationRow) => ({ ...row, createdAt: new Date(row.createdAt), readAt: row.readAt ? new Date(row.readAt) : null })));
      setPage(result.notifications.page);
      setHasMore(result.notifications.hasMore);
      setListLoaded(true);
      if (result.preferences) {
        setPreferences(result.preferences);
        setPrefsDraft(result.preferences.preferences);
        setMuteDraft(result.preferences.mutes.map((mute: { targetId: string }) => mute.targetId));
      }
      setUnreadOnly(nextUnreadOnly);
      announce('Notifications updated.');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Notifications could not be loaded. Please try again.', true);
    } finally { setBusy(false); }
  }

  async function savePreferences() {
    if (busyRef.current || !preferences) return;
    busyRef.current = true; setBusy(true);
    try {
      const mutes = preferences.channels.filter(channel => muteDraft.includes(channel.id)).map(channel => ({ targetId: channel.id, event: 'queueEmpty' as const }));
      const response = await fetch('/api/notifications', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...prefsDraft, mutes, confirmation: UPDATE_CONFIRMATION }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Notification preferences could not be saved.');
      const saved = result.preferences ?? result;
      if (typeof saved.preferences?.onNoteMention !== 'boolean' || typeof saved.preferences?.onQueueEmpty !== 'boolean' || !Array.isArray(saved.mutes)) throw new Error('The saved preferences could not be confirmed. Refresh to review their current state.');
      setPreferences(saved);
      setPrefsDraft(saved.preferences);
      setMuteDraft(saved.mutes.map((mute: { targetId: string }) => mute.targetId));
      setPrefsChanged(false); setReviewPrefs(false);
      announce('Notification preferences saved.');
    } catch (error) { announce(error instanceof Error ? error.message : 'Notification preferences could not be saved. Please try again.', true); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function confirmAction() {
    if (!action || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const { kind, item } = action;
    try {
      const method = kind === 'read' ? 'PATCH' : 'DELETE';
      const confirmation = `${kind === 'read' ? 'READ' : 'DELETE'} NOTIFICATION ${item.id}`;
      const response = await fetch(`/api/notifications?id=${encodeURIComponent(item.id)}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `This alert could not be ${kind === 'read' ? 'marked as read' : 'deleted'}.`);
      if (result.id !== item.id || (kind === 'read' ? result.read !== true : result.deleted !== true)) throw new Error('The result could not be confirmed. Refresh notifications before trying again.');
      setRows(current => kind === 'delete' || (kind === 'read' && unreadOnly) ? current.filter(row => row.id !== item.id) : current.map(row => row.id === item.id ? { ...row, readAt: result.readAt ?? new Date().toISOString() } : row));
      setAction(null);
      announce(kind === 'read' ? 'Alert marked as read.' : 'Alert deleted.');
    } catch (error) { announce(error instanceof Error ? error.message : 'The alert could not be updated. Please try again.', true); }
    finally { busyRef.current = false; setBusy(false); }
  }

  const tooManyMutes = Boolean(preferences && muteDraft.length > preferences.maxMutes);

  return <>
    <SidebarDock>
      <aside className={styles.sidebar} aria-label="Notification controls">
        <form className={styles.preferences} onSubmit={event => { event.preventDefault(); setReviewPrefs(true); }}>
          <h2>Email alerts</h2>
          <p>Choose the personal email updates you want.</p>
          <label className={styles.check}><input type="checkbox" checked={prefsDraft.onNoteMention} onChange={event => { const checked = event.currentTarget.checked; setPrefsDraft(current => ({ ...current, onNoteMention: checked })); setPrefsChanged(true); }} disabled={!preferences || busy} /><span>When a teammate mentions you in a note</span></label>
          <label className={styles.check}><input type="checkbox" checked={prefsDraft.onQueueEmpty} onChange={event => { const checked = event.currentTarget.checked; setPrefsDraft(current => ({ ...current, onQueueEmpty: checked })); setPrefsChanged(true); }} disabled={!preferences || busy} /><span>When a selected channel has nothing left in its queue</span></label>
          {preferences && preferences.channels.length > 0 && <fieldset className={styles.mutes}>
            <legend>Mute empty-queue emails by channel</legend>
            {preferences.channels.map(channel => <label key={channel.id} className={styles.check}><input type="checkbox" checked={muteDraft.includes(channel.id)} onChange={event => { const checked = event.currentTarget.checked; setMuteDraft(current => checked ? [...current, channel.id] : current.filter(id => id !== channel.id)); setPrefsChanged(true); }} disabled={busy} /><span>{channel.name}</span></label>)}
            <small>You can mute up to {preferences.maxMutes} channel{preferences.maxMutes === 1 ? '' : 's'}.</small>
          </fieldset>}
          {preferences && preferences.channels.length === 0 && <p className={styles.hint}>No channels are currently available for channel-specific mutes.</p>}
          <Button type="submit" variant="primary" disabled={!preferences || !prefsChanged || busy || tooManyMutes}>Review changes</Button>
          {tooManyMutes && <p className={styles.error}>Choose no more than {preferences?.maxMutes} channel mutes.</p>}
        </form>
        <div className={styles.sidebarSection}>
          <h2>Inbox view</h2>
          <label className={styles.check}><input type="checkbox" checked={unreadOnly} onChange={event => { const value = event.currentTarget.checked; void loadList(1, value); }} disabled={busy} /><span>Unread alerts only</span></label>
          <div className={styles.paging}>
            <Button size="sm" disabled={busy || page <= 1} onClick={() => void loadList(page - 1)}>Previous</Button>
            <span>Page {page}</span>
            <Button size="sm" disabled={busy || !hasMore} onClick={() => void loadList(page + 1)}>Next</Button>
          </div>
          <Button size="sm" onClick={() => void loadList(page)}>Refresh alerts</Button>
        </div>
      </aside>
    </SidebarDock>

    <section className={styles.inbox} aria-label="Your alerts">
      <header className={styles.inboxHeading}><div><h2>Your alerts</h2><p>Alerts are private to your account in this workspace.</p></div><span>{rows.filter(row => !row.readAt).length} unread on this page</span></header>
      {!preferences && <div className={styles.emptyState}><p>Your preferences could not be loaded.</p><Button onClick={() => void loadList(1)}>Retry</Button></div>}
      {!listLoaded && rows.length === 0 && preferences && <div className={styles.emptyState}><p>Your alerts could not be loaded.</p><Button onClick={() => void loadList(1)}>Retry</Button></div>}
      {listLoaded && rows.length === 0 && <div className={styles.emptyState}><h3>{page > 1 ? 'No alerts on this page' : unreadOnly ? 'No unread alerts' : 'No alerts yet'}</h3><p>{page > 1 ? 'Use the previous page control in the sidebar to review earlier alerts.' : unreadOnly ? 'Turn off the unread filter to review alerts you have already read.' : 'New mentions and content mix updates will appear here when they need your attention.'}</p></div>}
      {rows.length > 0 && <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="sr-only">Your personal notifications</caption>
          <thead><tr><th scope="col">Alert</th><th scope="col">When</th><th scope="col">Email outcome</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map(item => <tr key={item.id} data-unread={!item.readAt || undefined}>
            <td><span className={styles.title}>{item.title}</span><span className={styles.body}>{item.body}</span></td>
            <td><time dateTime={item.createdAt.toISOString()}>{new Date(item.createdAt).toLocaleString()}</time></td>
            <td>{emailOutcome(item.emailState)}</td>
            <td>{item.available ? `${item.readAt ? 'Read' : 'Unread'} · ${eventName(item.kind)}` : 'Source no longer available'}</td>
          <td><div className={styles.actions}>{!item.readAt && <Button size="sm" onClick={() => setAction({ kind: 'read', item })}>Mark read</Button>}<Button size="sm" variant="danger" onClick={() => setAction({ kind: 'delete', item })}>Delete</Button></div></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>

    {notice && !reviewPrefs && !action && <RouteNotice key={notice.key} focusKey={String(notice.key)} error={notice.error} className={styles.routeNotice}>{notice.message}</RouteNotice>}
    {reviewPrefs && <ModalDialog className={styles.modal} labelledBy="notification-prefs-title" onDismiss={() => setReviewPrefs(false)} busy={busy}>
      <div className={styles.dialog}><header><h2 id="notification-prefs-title">Review notification preferences</h2><p>These choices change email updates for your account only.</p></header>
        <ul><li>Note mention email: <strong>{prefsDraft.onNoteMention ? 'On' : 'Off'}</strong></li><li>Empty-queue email: <strong>{prefsDraft.onQueueEmpty ? 'On' : 'Off'}</strong></li><li>Channels muted for empty-queue email: <strong>{muteDraft.length}</strong></li></ul>
        {notice?.error && <RouteNotice key={notice.key} focusKey={String(notice.key)} error className={styles.dialogError}>{notice.message}</RouteNotice>}
        <footer><Button data-dialog-cancel onClick={() => setReviewPrefs(false)} disabled={busy}>Keep editing</Button><Button variant="primary" onClick={() => void savePreferences()} disabled={busy}>{busy ? 'Saving…' : 'Save preferences'}</Button></footer>
      </div>
    </ModalDialog>}
    {action && <ModalDialog className={styles.modal} labelledBy="notification-action-title" describedBy="notification-action-description" onDismiss={() => setAction(null)} busy={busy}>
      <div className={styles.dialog}><header><h2 id="notification-action-title">{action.kind === 'read' ? 'Mark this alert as read?' : 'Delete this alert?'}</h2><p id="notification-action-description">{action.item.title}</p></header>
        {action.kind === 'delete' && <p>This removes the alert from your inbox. It does not change the post, note or channel.</p>}
        {action.kind === 'read' && <p>The alert will stay in your inbox and can still be found in the full list.</p>}
        <p className={styles.reviewCopy}>Review the alert above, then choose {action.kind === 'read' ? 'Mark read' : 'Delete alert'} to confirm this exact action.</p>
        {notice?.error && <RouteNotice key={notice.key} focusKey={String(notice.key)} error className={styles.dialogError}>{notice.message}</RouteNotice>}
        <footer><Button data-dialog-cancel onClick={() => setAction(null)} disabled={busy}>Cancel</Button><Button variant={action.kind === 'delete' ? 'danger' : 'primary'} onClick={() => void confirmAction()} disabled={busy}>{busy ? 'Working…' : action.kind === 'read' ? 'Mark read' : 'Delete alert'}</Button></footer>
      </div>
    </ModalDialog>}
  </>;
}
