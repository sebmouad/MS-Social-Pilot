'use client';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';

import { useEffect, useState } from 'react';
import { DataTable, Badge, ConfirmDialog, useToast } from '@/components';
import { IconDevices } from '@tabler/icons-react';
import { useConfirm } from '@/components/useConfirm';
import type { AccountConfirmationCopy } from '../../account-confirmation-copy';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import styles from '@/modules/settings/ui/settings.module.css';
import { fill } from './copy';

type Session = { id: string; expiresAt: string; current: boolean };

export function AccountManager({ initialName, email, passwordPolicy, canWrite, nameMaxLength, confirmationCopy, sessionRevision = 0, locale = 'en' }: { sessionRevision?: number; canWrite: boolean; nameMaxLength: number; confirmationCopy: AccountConfirmationCopy; initialName: string; email: string; passwordPolicy: { minLength: number; maxBytes: number }; locale?: 'en' | 'fr' }) {
  const toast = useToast();
  const t = useSettingsCopy('account', locale);
  const [confirm, confirmationDialog] = useConfirm(confirmationCopy);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const nameValidation = useFormValidation();
  const passwordValidation = useFormValidation();

  useEffect(() => {
    let active = true;
    fetch('/api/settings/account/sessions', { cache: 'no-store' }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t.sessionsFailed);
      if (active) { setSessions(result.sessions); setNextOffset(result.nextOffset ?? null); }
    }).catch(() => { if (active) setNotice(t.sessionsFailed); });
    return () => { active = false; };
  }, [t, sessionRevision]);

  async function moreSessions() {
    if (busy || nextOffset === null) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/settings/account/sessions?offset=${nextOffset}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(t.sessionsFailed);
      setSessions(current => [...new Map([...current, ...result.sessions].map(session => [session.id, session])).values()]);
      setNextOffset(result.nextOffset ?? null);
    } catch { setNotice(t.sessionsFailed); }
    finally { setBusy(false); }
  }

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameValidation.validate(event.currentTarget, name.trim() ? {} : { name: t.nameRequired })) return;
    if (!canWrite || !await confirm(confirmationCopy.profile)) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, confirmation: 'UPDATE ACCOUNT PROFILE' }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.profileFailed);
      setName(result.name); setNotice(t.profileUpdated); toast.notify({ title: t.profileUpdated });
    } catch { setNotice(t.profileFailed); toast.failed(t.profileFailed, () => document.querySelector<HTMLInputElement>('[name="name"]')?.focus(), t.saveProfile); }
    finally { setBusy(false); }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const passwordErrors: Record<string, string> = {};
    if (new TextEncoder().encode(newPassword).length > passwordPolicy.maxBytes) passwordErrors.newPassword = fill(t.passwordTooLong, { max: passwordPolicy.maxBytes });
    if (!passwordValidation.validate(event.currentTarget, passwordErrors)) return;
    if (!canWrite || !await confirm(confirmationCopy.password)) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword, confirmation: 'CHANGE ACCOUNT PASSWORD' }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.passwordFailed);
      setCurrentPassword(''); setNewPassword(''); setSessions(current => current.filter(session => session.current)); setNextOffset(null); setNotice(t.passwordChanged); toast.notify({ title: t.passwordChanged });
    } catch { setNotice(t.passwordFailed); toast.failed(t.passwordFailed, () => document.querySelector<HTMLInputElement>('[name="currentPassword"]')?.focus(), t.changePassword); }
    finally { setBusy(false); }
  }

  async function revokeSession(id: string) {
    if (!canWrite) return t.revokeFailed;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account/sessions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, confirmation: `REVOKE ACCOUNT SESSION ${id}` }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.revokeFailed);
      setSessions(current => current.filter(session => session.id !== id)); setNotice(t.sessionRevoked); toast.notify({ title: t.sessionRevoked });
    } catch { setNotice(t.revokeFailed); toast.failed(t.revokeFailed, () => setPendingSession(id), t.signOut); return t.revokeFailed; }
    finally { setBusy(false); }
  }

  return <>{confirmationDialog}
    {pendingSession && <ConfirmDialog open title={t.signOut} objectName={`${t.otherSession} · ${pendingSession}`} consequence={confirmationCopy.session} confirmLabel={t.signOut} cancelLabel={confirmationCopy.cancel} failureLabel={t.revokeFailed} onClose={() => setPendingSession(null)} onConfirm={async () => (await revokeSession(pendingSession)) ?? null} />}
    <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{t.profile}</h2><p>{t.profileDetail}</p></div></div>
      <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={saveName}>
        <div className={styles['mcp-key-fields']}><label>{t.name}<input name="name" required maxLength={nameMaxLength} value={name} onChange={event => { setName(event.currentTarget.value); nameValidation.clear('name'); }} disabled={busy || !canWrite} {...nameValidation.fieldProps('name')} /><FieldError {...nameValidation.errorProps('name')} /></label><label>{t.email}<input name="email" value={email} readOnly aria-describedby="account-email-note" /></label></div>
        <p id="account-email-note" className={styles['settings-note']}>{t.emailNote}</p>
        <button type="submit" disabled={!canWrite || busy || name.trim() === initialName}>{t.saveProfile}</button>
      </form>
    </section>
    {canWrite && <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{t.password}</h2><p>{t.passwordDetail}</p></div></div>
      <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={changePassword}><div className={styles['mcp-key-fields']}>
        <label>{t.currentPassword}<input name="currentPassword" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => { setCurrentPassword(event.currentTarget.value); passwordValidation.clear('currentPassword'); }} disabled={busy} {...passwordValidation.fieldProps('currentPassword')} /><FieldError {...passwordValidation.errorProps('currentPassword')} /></label>
        <label>{t.newPassword}<input name="newPassword" type="password" autoComplete="new-password" minLength={passwordPolicy.minLength} maxLength={passwordPolicy.maxBytes} required value={newPassword} onChange={event => { setNewPassword(event.currentTarget.value); passwordValidation.clear('newPassword'); }} disabled={busy} {...passwordValidation.fieldProps('newPassword')} /><FieldError {...passwordValidation.errorProps('newPassword')} /></label>
      </div><p className={styles['settings-note']}>{fill(t.passwordRule, { min: passwordPolicy.minLength, max: passwordPolicy.maxBytes })}</p><button type="submit" disabled={busy}>{t.changePassword}</button></form>
    </section>}
    <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{t.sessions}</h2><p>{t.sessionsDetail}</p></div></div>
      <DataTable caption={t.sessions} rows={sessions} rowKey={session => session.id} emptyMessage={t.noSessions} emptyIcon={<IconDevices />} columns={[
        { key: 'session', label: t.session, render: session => <Badge tone={session.current ? 'module' : 'neutral'}>{session.current ? t.currentSession : t.otherSession}</Badge> },
        { key: 'expires', label: t.expires, render: session => new Date(session.expiresAt).toLocaleString(locale) },
        { key: 'actions', label: t.signOut, render: session => canWrite && !session.current && <button type="button" className="ui-button ui-button--quiet" disabled={busy} onClick={() => setPendingSession(session.id)}>{t.signOut}</button> },
      ]} />
    </section>
    {nextOffset !== null && <button type="button" disabled={busy} onClick={() => void moreSessions()}>{confirmationCopy.more}</button>}
    {notice && <p role="status" className={styles['settings-note']}>{notice}</p>}
  </>;
}
