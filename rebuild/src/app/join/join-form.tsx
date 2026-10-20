'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { AuthNotice, AuthShell, AuthStatus, authStyles } from '@/modules/home/auth/AuthShell';
import { authCopy, type AuthLocale } from '@/modules/home/auth/copy';
import type { AccountPasswordPolicy } from '@/server/account-settings';

type Invitation = { id: string; email: string; workspaceName: string; role: string; expiresAt: string; existingAccount: boolean; signedInEmail: string | null; needsEnrollment: boolean };
const manager = (role: string) => role === 'owner' || role === 'admin';
const validPreview = (value: unknown): value is Invitation => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return ['id','email','workspaceName','role','expiresAt'].every(key => typeof data[key] === 'string') && typeof data.existingAccount === 'boolean' && typeof data.needsEnrollment === 'boolean' && (data.signedInEmail === null || typeof data.signedInEmail === 'string');
};
export function JoinForm({ passwordPolicy, locale = 'en' }: { passwordPolicy: AccountPasswordPolicy; locale?: AuthLocale }) {
  const t = authCopy(locale).join;
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
      .then(async response => { const body: unknown = await response.json(); if (!response.ok) throw new Error(typeof (body as { error?: unknown })?.error === 'string' ? (body as {error:string}).error : t.openFailed); if (!validPreview(body)) throw new Error(t.unconfirmed); if (!controller.signal.aborted) { setInvitation(body); fragment.current = ''; } })
      .catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : t.loadFailed); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); pending.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the invitation is opened once per visit
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
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : t.unconfirmedAction);
      if (data.ok !== true || (action === 'accept' && data.joined !== true) || (action === 'register' && data.created !== true) || (action === 'enroll' && data.next !== '/two-step/enroll')) throw new Error(t.unconfirmedAction);
      if (action === 'register') { setPassword(''); setCreated(true); }
      else window.location.assign(action === 'enroll' ? '/two-step/enroll' : '/home');
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : t.unconfirmedAction); }
    finally { if (!controller.signal.aborted) { pending.current = null; setBusy(false); } }
  }
  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget, { ...(name.trim() ? {} : { name: t.nameEmpty }), ...(password.length >= passwordPolicy.minLength ? {} : { password: t.passwordShort(passwordPolicy.minLength) }) })) return;
    if (invitation) void act('register', { name, password, confirmation: `CREATE ACCOUNT AND JOIN ${invitation.id}` });
  }
  async function switchAccount() {
    if (pending.current) return;
    setBusy(true); setMessage('');
    try { const response = await fetch('/api/auth/sign-out', { method: 'POST' }); if (!response.ok) throw new Error(); window.location.assign('/sign-in'); }
    catch { setMessage(t.switchFailed); setBusy(false); }
  }
  const matches = invitation?.signedInEmail?.toLowerCase() === invitation?.email.toLowerCase();
  const invite = invitation ? t.inviteAs(invitation.workspaceName, invitation.role) : null;
  return <AuthShell title={created ? t.createdTitle : t.title} titleId="join-title" footer={!loading && !created ? <a className={authStyles.linkButton} href="/sign-in">{t.goSignIn}</a> : undefined}>
    {loading && <AuthStatus>{t.opening}</AuthStatus>}
    {message && <AuthNotice noticeRef={feedback}>{message}</AuthNotice>}
    {created ? <>
      <AuthNotice tone="success" noticeRef={feedback}>{t.createdBody}</AuthNotice>
      <a className="ui-button ui-button--primary" href="/sign-in">{t.signIn}</a>
    </> : invitation && invite && <>
      <p>{invite.before}<strong>{invite.workspace}</strong>{invite.middle}<strong>{invite.role}</strong>.</p>
      <p>{t.forEmail(invitation.email)} {manager(invitation.role) ? t.allChannels : t.noChannels}</p>
      {invitation.signedInEmail ? matches ? <>
        <p>{t.signedInAs(invitation.signedInEmail)}</p>
        <Button variant="primary" busy={busy} className={authStyles.fill} onClick={() => void act(invitation.needsEnrollment ? 'enroll' : 'accept', { confirmation: `${invitation.needsEnrollment ? 'ENROLL FOR' : 'ACCEPT'} INVITATION ${invitation.id}` })}>{busy ? t.continuing : invitation.needsEnrollment ? t.enroll : t.accept}</Button>
      </> : <><p>{t.switchLead}</p><Button busy={busy} className={authStyles.fill} onClick={() => void switchAccount()}>{busy ? t.switching : t.switchAccount}</Button></> : invitation.existingAccount ? <>
        <p>{t.existing}</p><a className="ui-button ui-button--primary" href="/sign-in">{t.signInToAccept}</a>
      </> : <form className={authStyles.form} method="post" noValidate onSubmit={register}>
        <div className={authStyles.field}>
          <label className={authStyles.label} htmlFor={validation.fieldProps('name').id}>{t.name}</label>
          <input className={authStyles.input} name="name" autoComplete="name" required maxLength={100} value={name} disabled={busy} onChange={event => { setName(event.currentTarget.value); validation.clear('name'); }} {...validation.fieldProps('name')} />
          <FieldError {...validation.errorProps('name')} />
        </div>
        <div className={authStyles.field}>
          <label className={authStyles.label} htmlFor={validation.fieldProps('password').id}>{t.password}</label>
          <div className={authStyles.control}>
            <input className={authStyles.input} name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={passwordPolicy.minLength} maxLength={200} value={password} disabled={busy} onChange={event => { setPassword(event.currentTarget.value); validation.clear('password'); }} {...validation.fieldProps('password', 'join-password-hint')} />
            <Button aria-label={showPassword ? t.hideLabel : t.showLabel} aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(!showPassword)}>{showPassword ? t.hide : t.show}</Button>
          </div>
          <p id="join-password-hint" className={authStyles.hint}>{t.passwordHint(passwordPolicy.minLength)}</p>
          <FieldError {...validation.errorProps('password')} />
        </div>
        <Button type="submit" variant="primary" busy={busy} className={authStyles.fill}>{busy ? t.creating : t.create}</Button>
      </form>}
    </>}
  </AuthShell>;
}
