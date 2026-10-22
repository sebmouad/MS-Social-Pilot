'use client';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';

import { ADDITIONAL_NOTIFICATION_PREFERENCES } from '@/modules/settings/notifications/catalog';
import { Switch, DataTable, Badge, EmptyState, ConfirmDialog, useToast } from '@/components';
import { IconBell } from '@tabler/icons-react';
import { useConfirm } from '@/components/useConfirm';
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { RouteNotice } from '@/components/RouteNotice';
import type { NotificationPage, NotificationPreferenceView, NotificationRow } from '@/modules/settings/notifications/server';
import { fill } from '@/modules/settings/ui/shell-copy';

import styles from './notifications.module.css';

type Notice = { message: string; error: boolean; key: number } | null;
type Action = { kind: 'read' | 'delete'; item: NotificationRow } | null;
type EmailPrefs = NotificationPreferenceView['preferences'];

const UPDATE_CONFIRMATION = 'UPDATE NOTIFICATION PREFERENCES';

export function NotificationCenter({ initialPreferences, initialPage, locale = initialPreferences?.locale ?? 'en' }: { initialPreferences: NotificationPreferenceView | null; initialPage: NotificationPage | null; locale?: 'en' | 'fr' }) {
  const toast = useToast();
  const retryFeedback = useRef<() => void>(() => {});
  const labels = useSettingsCopy('notificationLabels', locale);
  const t = useSettingsCopy('notifications', locale);
  const eventName = (kind: NotificationRow['kind']) => kind === 'note_mention' ? t.eventMention : t.eventMix;
  const emailOutcome = (state: NotificationRow['emailState']) => {
    switch (state) {
      case 'sent': return t.emailSent;
      case 'pending': return t.emailPending;
      case 'sending': return t.emailSending;
      case 'uncertain': return t.emailUncertain;
      case 'failed': return t.emailFailed;
      case 'cancelled': return t.emailCancelled;
      default: return t.emailUnknown;
    }
  };
  const [confirmPreferences, preferencesDialog] = useConfirm({ title: t.prefsDialogTitle, cancel: t.cancel, confirm: t.save, danger: false });
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
    if (error) toast.failed(message, () => retryFeedback.current(), t.retry); else toast.notify({ title: message });
    setNextKey(value => value + 1);
  }

  async function loadList(nextPage = page, nextUnreadOnly = unreadOnly) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const query = new URLSearchParams({ page: String(nextPage) });
      if (nextUnreadOnly) query.set('unreadOnly', 'true');
      const response = await fetch(`/api/notifications?${query}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t.loadFailed);
      if (!Array.isArray(result.notifications?.items) || !Number.isInteger(result.notifications?.page) || typeof result.notifications?.hasMore !== 'boolean') throw new Error(t.loadUnconfirmed);
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
      announce(t.updated);
    } catch (error) {
      announce(error instanceof Error ? error.message : t.loadRetry, true);
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function savePreferences(nextPrefs = prefsDraft, nextMutes = muteDraft) {
    if (busyRef.current || !preferences) return;
    busyRef.current = true; setBusy(true);
    try {
      const mutes = preferences.channels.filter(channel => nextMutes.includes(channel.id)).map(channel => ({ targetId: channel.id, event: 'queueEmpty' as const }));
      const response = await fetch('/api/notifications', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...nextPrefs, mutes, confirmation: UPDATE_CONFIRMATION }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t.prefsSaveFailed);
      const saved = result.preferences ?? result;
      if (typeof saved.preferences?.onNoteMention !== 'boolean' || typeof saved.preferences?.onQueueEmpty !== 'boolean' || !Array.isArray(saved.mutes)) throw new Error(t.prefsUnconfirmed);
      setPreferences(saved);
      setPrefsDraft(saved.preferences);
      setMuteDraft(saved.mutes.map((mute: { targetId: string }) => mute.targetId));
      setPrefsChanged(false); setReviewPrefs(false);
      announce(t.prefsSaved);
    } catch (error) { announce(error instanceof Error ? error.message : t.prefsRetry, true); }
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
      if (!response.ok) throw new Error(result.error ?? (kind === 'read' ? t.readFailed : t.deleteFailed));
      if (result.id !== item.id || (kind === 'read' ? result.read !== true : result.deleted !== true)) throw new Error(t.actionUnconfirmed);
      setRows(current => kind === 'delete' || (kind === 'read' && unreadOnly) ? current.filter(row => row.id !== item.id) : current.map(row => row.id === item.id ? { ...row, readAt: result.readAt ?? new Date().toISOString() } : row));
      setAction(null);
      announce(kind === 'read' ? t.markedRead : t.deleted);
    } catch (error) { const message = error instanceof Error ? error.message : t.updateRetry; announce(message, true); return message; }
    finally { busyRef.current = false; setBusy(false); }
  }

  retryFeedback.current = () => { if (prefsChanged) setReviewPrefs(true); else void loadList(page); };
  const tooManyMutes = Boolean(preferences && muteDraft.length > preferences.maxMutes);

  return <>
    {preferencesDialog}
    <aside className={styles.sidebar} aria-label={t.controls}>
      <form noValidate className={styles.preferences} onSubmit={event => { event.preventDefault(); if (!ADDITIONAL_NOTIFICATION_PREFERENCES.some(key => prefsDraft[key] !== preferences?.preferences[key])) { setReviewPrefs(true); return; } void confirmPreferences(t.savePrompt).then(ok => { if (ok) void savePreferences(); }); }}>
        <h2>{t.emailAlerts}</h2>
        <p>{t.emailAlertsHint}</p>
        <Switch label={t.onMention} checked={prefsDraft.onNoteMention} onChange={checked => { const next = { ...prefsDraft, onNoteMention: checked }; setPrefsDraft(next); setPrefsChanged(true); void savePreferences(next); }} disabled={!preferences || busy} />
        <Switch label={t.onQueueEmpty} checked={prefsDraft.onQueueEmpty} onChange={checked => { const next = { ...prefsDraft, onQueueEmpty: checked }; setPrefsDraft(next); setPrefsChanged(true); void savePreferences(next); }} disabled={!preferences || busy} />
        {preferences && preferences.channels.length > 0 && <fieldset className={styles.mutes}>
          <legend>{t.muteLegend}</legend>
          {preferences.channels.map(channel => <label key={channel.id} className={styles.check}><input type="checkbox" checked={muteDraft.includes(channel.id)} onChange={event => { const checked = event.currentTarget.checked; setMuteDraft(current => checked ? [...current, channel.id] : current.filter(id => id !== channel.id)); setPrefsChanged(true); }} disabled={busy} /><span>{channel.name}</span></label>)}
          <small>{preferences.maxMutes === 1 ? t.muteLimitOne : fill(t.muteLimitMany, { max: preferences.maxMutes })}</small>
        </fieldset>}
        {preferences && preferences.channels.length === 0 && <p className={styles.hint}>{t.noMuteChannels}</p>}
        <p>{labels.pending}</p>
        {ADDITIONAL_NOTIFICATION_PREFERENCES.map(key => <Switch key={key} label={labels[key]} checked={prefsDraft[key] ?? (key !== 'onNewInbox')} onChange={checked => { const next = { ...prefsDraft, [key]: checked }; setPrefsDraft(next); setPrefsChanged(true); void savePreferences(next); }} disabled={!preferences || busy} />)}
        <Button type="submit" variant="primary" disabled={!preferences || !prefsChanged || busy || tooManyMutes}>{t.review}</Button>
        {tooManyMutes && <p className={styles.error}>{fill(t.tooManyMutes, { max: preferences?.maxMutes ?? 0 })}</p>}
      </form>
      <div className={styles.sidebarSection}>
        <h2>{t.inboxView}</h2>
        <label className={styles.check}><input type="checkbox" checked={unreadOnly} onChange={event => { const value = event.currentTarget.checked; void loadList(1, value); }} disabled={busy} /><span>{t.unreadOnly}</span></label>
        <div className={styles.paging}>
          <Button size="sm" disabled={busy || page <= 1} onClick={() => void loadList(page - 1)}>{t.previous}</Button>
          <span>{fill(t.page, { page })}</span>
          <Button size="sm" disabled={busy || !hasMore} onClick={() => void loadList(page + 1)}>{t.next}</Button>
        </div>
        <Button size="sm" onClick={() => void loadList(page)}>{t.refresh}</Button>
      </div>
    </aside>

    <section className={styles.inbox} aria-label={t.alerts}>
      <header className={styles.inboxHeading}><div><h2>{t.alerts}</h2><p>{t.alertsHint}</p></div><span>{fill(t.unreadCount, { count: rows.filter(row => !row.readAt).length })}</span></header>
      {!preferences && <div className={styles.emptyState}><p>{t.prefsMissing}</p><Button onClick={() => void loadList(1)}>{t.retry}</Button></div>}
      {!listLoaded && rows.length === 0 && preferences && <div className={styles.emptyState}><p>{t.alertsMissing}</p><Button onClick={() => void loadList(1)}>{t.retry}</Button></div>}
      {listLoaded && rows.length === 0 && <EmptyState title={page > 1 ? t.emptyPageTitle : unreadOnly ? t.emptyUnreadTitle : t.emptyTitle} icon={<IconBell />} action={<Button onClick={() => void loadList(1, false)}>{t.refresh}</Button>}>{page > 1 ? t.emptyPageBody : unreadOnly ? t.emptyUnreadBody : t.emptyBody}</EmptyState>}
      {rows.length > 0 && <DataTable caption={t.tableCaption} rows={rows} rowKey={item => item.id} columns={[
        { key: 'title', label: t.alert, render: item => <><span className={styles.title}>{item.title}</span><span className={styles.body}>{item.body}</span></> },
        { key: 'when', label: t.when, render: item => <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString(locale)}</time> },
        { key: 'email', label: t.emailOutcome, render: item => emailOutcome(item.emailState) },
        { key: 'status', label: t.status, render: item => <Badge tone={item.readAt ? 'neutral' : 'module'}>{item.available ? `${item.readAt ? t.read : t.unread} · ${eventName(item.kind)}` : t.sourceGone}</Badge> },
        { key: 'actions', label: t.actions, render: item => <div className={styles.actions}>{!item.readAt && <Button size="sm" disabled={busy} onClick={() => setAction({ kind: 'read', item })}>{t.markRead}</Button>}<Button size="sm" disabled={busy} variant="danger" onClick={() => setAction({ kind: 'delete', item })}>{t.delete}</Button></div> },
      ]} />}

    </section>

    {notice && !reviewPrefs && !action && <RouteNotice key={notice.key} focusKey={String(notice.key)} error={notice.error} className={styles.routeNotice}>{notice.message}</RouteNotice>}
    {reviewPrefs && <ModalDialog className={styles.modal} labelledBy="notification-prefs-title" onDismiss={() => setReviewPrefs(false)} busy={busy}>
      <div className={styles.dialog}><header><h2 id="notification-prefs-title">{t.reviewTitle}</h2><p>{t.reviewHint}</p></header>
        <ul><li>{t.mentionEmail} <strong>{prefsDraft.onNoteMention ? t.on : t.off}</strong></li><li>{t.queueEmail} <strong>{prefsDraft.onQueueEmpty ? t.on : t.off}</strong></li><li>{t.mutedCount} <strong>{muteDraft.length}</strong></li></ul>
        {notice?.error && <RouteNotice key={notice.key} focusKey={String(notice.key)} error className={styles.dialogError}>{notice.message}</RouteNotice>}
        <footer><Button data-dialog-cancel onClick={() => setReviewPrefs(false)} disabled={busy}>{t.keepEditing}</Button><Button variant="primary" onClick={() => void savePreferences()} disabled={busy}>{busy ? t.saving : t.savePreferences}</Button></footer>
      </div>
    </ModalDialog>}
    {action && <ConfirmDialog open title={action.kind === 'read' ? t.markReadTitle : t.deleteTitle} objectName={action.item.title} consequence={action.kind === 'delete' ? t.deleteBody : t.readBody} confirmLabel={action.kind === 'read' ? t.markRead : t.deleteAlert} cancelLabel={t.cancel} pendingLabel={t.working} failureLabel={t.updateRetry} danger={action.kind === 'delete'} onClose={() => setAction(null)} onConfirm={async () => (await confirmAction()) ?? null} />}

  </>;
}
