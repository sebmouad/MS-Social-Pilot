'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import type { AccountPasswordPolicy } from '@/server/account-settings';

type Invitation = { id: string; email: string; workspaceName: string; role: string; expiresAt: string; existingAccount: boolean; signedInEmail: string | null; needsEnrollment: boolean };
const manager = (role: string) => role === 'owner' || role === 'admin';
const validPreview = (value: unknown): value is Invitation => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return ['id','email','workspaceName','role','expiresAt'].every(key => typeof data[key] === 'string') && typeof data.existingAccount === 'boolean' && typeof data.needsEnrollment === 'boolean' && (data.signedInEmail === null || typeof data.signedInEmail === 'string');
};
export function JoinForm({ passwordPolicy }: { passwordPolicy: AccountPasswordPolicy }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [created, setCreated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const pending = useRef<AbortController | null>(null);
  const fragment = useRef<string | undefined>(undefined);
  const feedback = useRef<HTMLParagraphElement>(null);
  const validation = useFormValidation();
  useEffect(() => {
    const controller = new AbortController();
    if (fragment.current === undefined) fragment.current = window.location.hash.slice(1);
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname);
    const token = fragment.current;
    void fetch('/api/auth/invitations/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { token } : {}), signal: controller.signal })
      .then(async response => { const body: unknown = await response.json(); if (!response.ok) throw new Error(typeof (body as { error?: unknown })?.error === 'string' ? (body as {error:string}).error : 'This invitation could not be opened. Ask for a new invitation.'); if (!validPreview(body)) throw new Error('This invitation could not be confirmed. Open the email link again.'); if (!controller.signal.aborted) { setInvitation(body); fragment.current = ''; } })
      .catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'The invitation could not be loaded. Open the email link again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, []);
  useEffect(() => { if (message || created) feedback.current?.focus(); }, [message, created]);

  async function act(action: 'accept' | 'register' | 'enroll', body: Record<string, unknown>) {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/auth/invitations/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const result: unknown = await response.json();
      if (controller.signal.aborted) return;
      const data = result && typeof result === 'object' ? result as Record<string, unknown> : {};
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The operation could not be confirmed. Check your account before trying again.');
      if (data.ok !== true || (action === 'accept' && data.joined !== true) || (action === 'register' && data.created !== true) || (action === 'enroll' && data.next !== '/two-step/enroll')) throw new Error('The operation could not be confirmed. Check your account before trying again.');
      if (action === 'register') { setPassword(''); setCreated(true); }
      else window.location.assign(action === 'enroll' ? '/two-step/enroll' : '/home');
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'The operation could not be confirmed. Check your account before trying again.'); }
    finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
  }
  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget, { ...(name.trim() ? {} : { name: 'Enter your name.' }), ...(password.length >= passwordPolicy.minLength ? {} : { password: `Use at least ${passwordPolicy.minLength} characters.` }) })) return;
    if (invitation) void act('register', { name, password, confirmation: `CREATE ACCOUNT AND JOIN ${invitation.id}` });
  }
  async function switchAccount() {
    if (pending.current) return;
    setBusy(true); setMessage('');
    try { const response = await fetch('/api/auth/sign-out', { method: 'POST' }); if (!response.ok) throw new Error(); window.location.assign('/sign-in'); }
    catch { setMessage('Sign-out could not be confirmed. Try again before switching accounts.'); setBusy(false); }
  }
  return <main className="auth-screen"><section className="auth-card" aria-labelledby="join-title">
    <p className="eyebrow">Social Pilot</p><h1 id="join-title">{created ? 'Your account is ready' : 'Join a workspace'}</h1>
    {loading && <p role="status">Opening your invitation…</p>}
    {message && <p ref={feedback} tabIndex={-1} role="alert" className="auth-field-error">{message}</p>}
    {created ? <><p ref={feedback} tabIndex={-1} role="status">Your account and workspace membership were created. Sign in to complete any required verification.</p><a className="ui-button ui-button--primary" href="/sign-in">Sign in</a></> : invitation && <>
      <p>You’re invited to <strong>{invitation.workspaceName}</strong> as <strong>{invitation.role}</strong>.</p>
      <p>For {invitation.email}. {manager(invitation.role) ? 'This role includes every channel.' : 'You’ll start without channel access. A workspace manager can assign channels after you join.'}</p>
      {invitation.signedInEmail ? invitation.signedInEmail.toLowerCase() === invitation.email.toLowerCase() ? <>
        <p>Signed in as {invitation.signedInEmail}.</p>
        <Button variant="primary" disabled={busy} onClick={() => void act(invitation.needsEnrollment ? 'enroll' : 'accept', { confirmation: `${invitation.needsEnrollment ? 'ENROLL FOR' : 'ACCEPT'} INVITATION ${invitation.id}` })}>{busy ? 'Continuing…' : invitation.needsEnrollment ? 'Set up verification to join' : 'Accept invitation'}</Button>
      </> : <><p>Switch to the invited account to accept this invitation.</p><Button disabled={busy} onClick={() => void switchAccount()}>Switch account</Button></> : invitation.existingAccount ? <><p>Sign in with your existing account, including verification. You’ll return here to accept the invitation.</p><a className="ui-button ui-button--primary" href="/sign-in">Sign in to accept</a></> : <form method="post" noValidate onSubmit={register}>
        <label htmlFor={validation.fieldProps('name').id}>Your name</label><input name="name" autoComplete="name" required maxLength={100} value={name} disabled={busy} onChange={event => { setName(event.currentTarget.value); validation.clear('name'); }} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} />
        <label htmlFor={validation.fieldProps('password').id}>Create a password</label><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={passwordPolicy.minLength} maxLength={200} value={password} disabled={busy} onChange={event => { setPassword(event.currentTarget.value); validation.clear('password'); }} {...validation.fieldProps('password')} /><FieldError {...validation.errorProps('password')} />
        <Button size="sm" aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide password' : 'Show password'}</Button>
        <p>Use at least {passwordPolicy.minLength} characters. Creating an account accepts this workspace invitation.</p>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Creating account…' : 'Create account and join'}</Button>
      </form>}
    </>}
    {!loading && !created && <p><a href="/sign-in">Go to sign in</a></p>}
  </section></main>;
}
