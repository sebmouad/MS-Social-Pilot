'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { validateFields } from '@/lib/ui/form-validation';
import { AuthField, AuthNotice, AuthShell, authStyles } from '@/modules/home/auth/AuthShell';
import { authCopy, type AuthLocale } from '@/modules/home/auth/copy';

export function SignInForm({ locale = 'en' }: { locale?: AuthLocale }) {
  const copy = authCopy(locale);
  const t = copy.signIn;
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signUpOpen, setSignUpOpen] = useState(false);
  useEffect(() => { void fetch('/api/auth/register', { cache: 'no-store' }).then(r => r.json()).then((b: { available?: boolean }) => setSignUpOpen(b.available === true)).catch(() => undefined); }, []);

  async function signOut() {
    setSigningOut(true); setMessage(null);
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' });
      setMessage(response.ok ? { tone: 'info', text: t.signedOut } : { tone: 'error', text: t.signOutFailed });
    } catch { setMessage({ tone: 'error', text: t.signOutFailed }); }
    finally { setSigningOut(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const fieldErrors = validateFields(event.currentTarget, {
      email: { empty: t.emailEmpty, invalid: t.emailInvalid },
      password: { empty: t.passwordEmpty },
    });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/sign-in', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const result = await response.json().catch(() => ({})) as { next?: string; nextUrl?: string };
      if (!response.ok) {
        setMessage({ tone: 'error', text: response.status === 429 ? copy.tooMany : t.failed });
        setBusy(false);
        return;
      }
      // Keep the button busy through navigation so a second click cannot resubmit.
      if (result.next === 'verify') window.location.assign('/two-step');
      else if (result.next === 'enroll') window.location.assign('/two-step/enroll');
      else window.location.assign(result.nextUrl === '/join' ? '/join' : '/home');
    } catch {
      setMessage({ tone: 'error', text: t.unavailable });
      setBusy(false);
    }
  }

  return <AuthShell title={t.title} lead={t.lead} footer={<button type="button" className={authStyles.linkButton} onClick={signOut} disabled={signingOut}>{signingOut ? t.signingOut : t.signOut}</button>}>
    <form className={authStyles.form} method="post" noValidate onSubmit={submit}>
      <AuthField id="email" name="email" type="email" label={t.email} autoComplete="username" required maxLength={320} spellCheck={false} error={errors.email} disabled={busy} />
      <AuthField id="password" name="password" type={showPassword ? 'text' : 'password'} label={t.password} autoComplete="current-password" required maxLength={200} error={errors.password} disabled={busy}
        trailing={<Button aria-label={showPassword ? t.hideLabel : t.showLabel} aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>{showPassword ? t.hide : t.show}</Button>} />
      {message && <AuthNotice tone={message.tone}>{message.text}</AuthNotice>}
      <Button type="submit" variant="primary" busy={busy} className={authStyles.fill}>{busy ? t.busy : t.submit}</Button>
    </form>
    <p className={authStyles.links}><a href="/password-recovery">{t.forgot}</a>{signUpOpen && <a href="/sign-up">{t.create}</a>}</p>
  </AuthShell>;
}
