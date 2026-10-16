'use client';

import { useEffect, useState } from 'react';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import styles from '../settings.module.css';

type Session = { id: string; expiresAt: string; current: boolean };

export function AccountManager({ initialName, email, passwordPolicy }: { initialName: string; email: string; passwordPolicy: { minLength: number; maxBytes: number } }) {
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
      if (!response.ok) throw new Error(result.error ?? 'Could not load sessions.');
      if (active) setSessions(result.sessions);
    }).catch(error => { if (active) setNotice(error instanceof Error ? error.message : 'Could not load sessions.'); });
    return () => { active = false; };
  }, []);

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameValidation.validate(event.currentTarget, name.trim() ? {} : { name: 'Enter a name for your profile.' })) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Could not update profile.');
      setName(result.name); setNotice('Profile updated.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not update profile.'); }
    finally { setBusy(false); }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const passwordErrors: Record<string, string> = {};
    if (new TextEncoder().encode(newPassword).length > passwordPolicy.maxBytes) passwordErrors.newPassword = `Use no more than ${passwordPolicy.maxBytes} bytes.`;
    if (!passwordValidation.validate(event.currentTarget, passwordErrors)) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Could not change password.');
      setCurrentPassword(''); setNewPassword(''); setSessions(current => current.filter(session => session.current)); setNotice('Password changed. Other active sessions were signed out.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not change password.'); }
    finally { setBusy(false); }
  }

  async function revokeSession(id: string) {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/account/sessions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Could not revoke session.');
      setSessions(current => current.filter(session => session.id !== id)); setNotice('Session signed out.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not revoke session.'); }
    finally { setBusy(false); }
  }

  return <>
    <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>Profile</h2><p>Update the name shown to your team.</p></div></div>
      <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={saveName}>
        <div className={styles['mcp-key-fields']}><label>Name<input name="name" required maxLength={100} value={name} onChange={event => { setName(event.currentTarget.value); nameValidation.clear('name'); }} disabled={busy} {...nameValidation.fieldProps('name')} /><FieldError {...nameValidation.errorProps('name')} /></label><label>Email<input name="email" value={email} readOnly aria-describedby="account-email-note" /></label></div>
        <p id="account-email-note" className={styles['settings-note']}>Email changes require a verified address and are not available yet.</p>
        <button type="submit" disabled={busy || name.trim() === initialName}>Save profile</button>
      </form>
    </section>
    <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>Password</h2><p>Changing your password signs out other active sessions.</p></div></div>
      <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={changePassword}><div className={styles['mcp-key-fields']}>
        <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => { setCurrentPassword(event.currentTarget.value); passwordValidation.clear('currentPassword'); }} disabled={busy} {...passwordValidation.fieldProps('currentPassword')} /><FieldError {...passwordValidation.errorProps('currentPassword')} /></label>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={passwordPolicy.minLength} maxLength={passwordPolicy.maxBytes} required value={newPassword} onChange={event => { setNewPassword(event.currentTarget.value); passwordValidation.clear('newPassword'); }} disabled={busy} {...passwordValidation.fieldProps('newPassword')} /><FieldError {...passwordValidation.errorProps('newPassword')} /></label>
      </div><p className={styles['settings-note']}>Use at least {passwordPolicy.minLength} characters, up to {passwordPolicy.maxBytes} bytes.</p><button type="submit" disabled={busy}>Change password</button></form>
    </section>
    <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>Active sessions</h2><p>Sign out sessions you no longer recognize. This browser is marked as current.</p></div></div>
      <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th>Session</th><th>Expires</th><th /></tr></thead><tbody>
        {sessions.map(session => <tr key={session.id}><td>{session.current ? 'This browser · current' : 'Signed-in session'}</td><td>{new Date(session.expiresAt).toLocaleString()}</td><td>{!session.current && <button type="button" disabled={busy} onClick={() => revokeSession(session.id)}>Sign out</button>}</td></tr>)}
        {!sessions.length && <tr><td colSpan={3}>No active sessions found.</td></tr>}
      </tbody></table></div>
    </section>
    {notice && <p role="status" className={styles['settings-note']}>{notice}</p>}
  </>;
}
