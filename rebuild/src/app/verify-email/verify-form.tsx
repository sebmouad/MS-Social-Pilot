'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { validateFields } from '@/lib/ui/form-validation';
import { AuthField, AuthNotice, AuthShell, AuthStatus, authStyles } from '@/modules/home/auth/AuthShell';
import { authCopy, type AuthLocale } from '@/modules/home/auth/copy';
import { consumeRecoveryFragment } from '../password-recovery/recovery-form';

type State = 'loading' | 'confirming' | 'confirmed' | 'failed' | 'resend' | 'resent';

/** Reads the one-use token from the URL fragment (never sent to the server in the request line), then confirms it once. */
export function VerifyEmailForm({ locale = 'en' }: { locale?: AuthLocale }) {
  const copy = authCopy(locale);
  const t = copy.verifyEmail;
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [pending, setPending] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; started.current = true;
    const token = consumeRecoveryFragment(window.location, window.history);
    if (!token) { setState('resend'); return; }
    setState('confirming');
    void (async () => {
      try {
        const response = await fetch('/api/auth/verify-email', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ token }) });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) { setError(response.status === 429 ? copy.tooMany : body.error ?? t.linkInvalid); setState('failed'); return; }
        setState('confirmed');
      } catch { setError(copy.offline); setState('failed'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; the token is consumed from the address
  }, []);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const errors = validateFields(event.currentTarget, { email: { empty: t.emailEmpty, invalid: t.emailInvalid } });
    setFieldError(errors.email ?? '');
    if (errors.email) return;
    setPending(true);
    try {
      const response = await fetch('/api/auth/verify-email/resend', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ email: String(new FormData(event.currentTarget).get('email') ?? '') }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(response.status === 429 ? copy.tooMany : body.error ?? t.sendFailed); return; }
      setState('resent');
    } catch { setError(copy.offline); }
    finally { setPending(false); }
  }

  if (state === 'loading' || state === 'confirming') return <AuthShell title={t.title}><AuthStatus>{t.confirming}</AuthStatus></AuthShell>;
  if (state === 'confirmed') return <AuthShell title={t.confirmedTitle}>
    <AuthNotice tone="success">{t.confirmed}</AuthNotice>
    <a className="ui-button ui-button--primary" href="/sign-in">{t.continue}</a>
  </AuthShell>;
  if (state === 'resent') return <AuthShell title={t.sentTitle}>
    <AuthNotice tone="success">{t.sent}</AuthNotice>
    <p className={authStyles.links}><a href="/sign-in">{copy.backToSignIn}</a></p>
  </AuthShell>;
  return <AuthShell title={t.title} lead={t.lead} footer={<a className={authStyles.linkButton} href="/sign-in">{copy.backToSignIn}</a>}>
    <form className={authStyles.form} method="post" noValidate onSubmit={resend}>
      {error && <AuthNotice>{error}</AuthNotice>}
      <AuthField id="verify-email" name="email" type="email" label={t.email} required maxLength={320} autoComplete="email" spellCheck={false} error={fieldError} disabled={pending} />
      <Button type="submit" variant="primary" busy={pending} className={authStyles.fill}>{pending ? t.sending : t.send}</Button>
    </form>
  </AuthShell>;
}
