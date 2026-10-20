'use client';

import { useEffect, useState } from 'react';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import styles from '@/modules/settings/ui/settings.module.css';
import { accountCopy, fill } from './copy';

type Session = { id: string; expiresAt: string; current: boolean };

export function AccountManager({ initialName, email, passwordPolicy, locale = 'en' }: { initialName: string; email: string; passwordPolicy: { minLength: number; maxBytes: number }; locale?: 'en' | 'fr' }) {
  const t = accountCopy[locale];
  const [name, setName] = useState(initialName);
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
      if (active) setSessions(result.sessions);
    }).catch(error => { if (active) setNotice(error instanceof Error ? error.message : t.sessionsFailed); });
    return () => { active = false; };
  }, [t]);

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameValidation.validate(event.currentTarget, name.trim() ? {} : { name: t.nameRequired })) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.profileFailed);
      setName(result.name); setNotice(t.profileUpdated);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.profileFailed); }
    finally { setBusy(false); }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const passwordErrors: Record<string, string> = {};
    if (new TextEncoder().encode(newPassword).length > passwordPolicy.maxBytes) passwordErrors.newPassword = fill(t.passwordTooLong, { max: passwordPolicy.maxBytes });
    if (!passwordValidation.validate(event.currentTarget, passwordErrors)) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.passwordFailed);
      setCurrentPassword(''); setNewPassword(''); setSessions(current => current.filter(session => session.current)); setNotice(t.passwordChanged);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.passwordFailed); }
    finally { setBusy(false); }
  }

  async function revokeSession(id: string) {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account/sessions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t.revokeFailed);
      setSessions(current => current.filter(session => session.id !== id)); setNotice(t.sessionRevoked);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.revokeFailed); }
    finally { setBusy(false); }
  }

  return <>
    <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{t.profile}</h2><p>{t.profileDetail}</p></div></div>
      <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={saveName}>
        <div className={styles['mcp-key-fields']}><label>{t.name}<input name="name" required maxLength={100} value={name} onChange={event => { setName(event.currentTarget.value); nameValidation.clear('name'); }} disabled={busy} {...nameValidation.fieldProps('name')} /><FieldError {...nameValidation.errorProps('name')} /></label><label>{t.email}<input name="email" value={email} readOnly aria-describedby="account-email-note" /></label></div>
        <p id="account-email-note" className={styles['settings-note']}>{t.emailNote}</p>
        <button type="submit" disabled={busy || name.trim() === initialName}>{t.saveProfile}</button>
      </form>
    </section>
    <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{t.password}</h2><p>{t.passwordDetail}</p></div></div>
      <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={changePassword}><div className={styles['mcp-key-fields']}>
        <label>{t.currentPassword}<input name="currentPassword" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => { setCurrentPassword(event.currentTarget.value); passwordValidation.clear('currentPassword'); }} disabled={busy} {...passwordValidation.fieldProps('currentPassword')} /><FieldError {...passwordValidation.errorProps('currentPassword')} /></label>
        <label>{t.newPassword}<input name="newPassword" type="password" autoComplete="new-password" minLength={passwordPolicy.minLength} maxLength={passwordPolicy.maxBytes} required value={newPassword} onChange={event => { setNewPassword(event.currentTarget.value); passwordValidation.clear('newPassword'); }} disabled={busy} {...passwordValidation.fieldProps('newPassword')} /><FieldError {...passwordValidation.errorProps('newPassword')} /></label>
      </div><p className={styles['settings-note']}>{fill(t.passwordRule, { min: passwordPolicy.minLength, max: passwordPolicy.maxBytes })}</p><button type="submit" disabled={busy}>{t.changePassword}</button></form>
    </section>
    <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{t.sessions}</h2><p>{t.sessionsDetail}</p></div></div>
      <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th>{t.session}</th><th>{t.expires}</th><th /></tr></thead><tbody>
        {sessions.map(session => <tr key={session.id}><td>{session.current ? t.currentSession : t.otherSession}</td><td>{new Date(session.expiresAt).toLocaleString(locale)}</td><td>{!session.current && <button type="button" disabled={busy} onClick={() => revokeSession(session.id)}>{t.signOut}</button>}</td></tr>)}
        {!sessions.length && <tr><td colSpan={3}>{t.noSessions}</td></tr>}
      </tbody></table></div>
    </section>
    {notice && <p role="status" className={styles['settings-note']}>{notice}</p>}
  </>;
}
