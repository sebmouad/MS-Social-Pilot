'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { FormEvent, useState } from 'react';
import { Button } from '@/components/Button';
import { validateFields } from '@/lib/ui/form-validation';
import { AuthField, AuthNotice, AuthShell, authStyles } from '@/modules/home/auth/AuthShell';
import { authCopy, type AuthLocale } from '@/modules/home/auth/copy';

export function VerifyForm({ hasPasskey, locale = 'en' }: { hasPasskey: boolean; locale?: AuthLocale }) {
  const copy = authCopy(locale);
  const t = copy.twoStep;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'code' | 'passkey' | null>(null);
  const [fieldError, setFieldError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateFields(event.currentTarget, { code: { empty: t.empty } });
    setFieldError(errors.code ?? '');
    if (errors.code) return;
    setBusy('code');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/two-step/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: form.get('code') }) });
      if (response.ok) {
        const result = await response.json().catch(() => ({})) as { nextUrl?: string };
        window.location.assign(result.nextUrl === '/join' ? '/join' : '/home');
        return;
      }
      setError(response.status === 429 ? copy.tooMany : t.rejected);
    } catch { setError(t.unavailable); }
    setBusy(null);
  }
  async function verifyPasskey() {
    setBusy('passkey');
    setError('');
    try {
      const start = await fetch('/api/auth/passkey/options', { method: 'POST' });
      if (!start.ok) throw new Error(start.status === 429 ? copy.tooMany : t.passkeyUnavailable);
      const data = await start.json() as { options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };
      const response = await startAuthentication({ optionsJSON: data.options });
      const finish = await fetch('/api/auth/passkey/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response }) });
      if (!finish.ok) throw new Error(finish.status === 429 ? copy.tooMany : t.passkeyRejected);
      const result = await finish.json().catch(() => ({})) as { nextUrl?: string };
      window.location.assign(result.nextUrl === '/join' ? '/join' : '/home');
      return;
    } catch (cause) { setError(cause instanceof Error && cause.name === 'Error' ? cause.message : t.passkeyCancelled); }
    setBusy(null);
  }
  return <AuthShell title={t.title} lead={t.lead} footer={<a className={authStyles.linkButton} href="/sign-in">{copy.backToSignIn}</a>}>
    {hasPasskey && <>
      <Button variant="primary" busy={busy === 'passkey'} disabled={busy !== null} onClick={verifyPasskey} className={authStyles.fill}>{busy === 'passkey' ? t.passkeyBusy : t.passkey}</Button>
      <p className={authStyles.divider} aria-hidden="true">{t.or}</p>
    </>}
    <form className={authStyles.form} method="post" noValidate onSubmit={submit}>
      <AuthField id="two-step-code" name="code" label={t.code} hint={t.hint} autoComplete="one-time-code" required minLength={6} maxLength={32} spellCheck={false} error={fieldError} disabled={busy !== null} />
      {error && <AuthNotice>{error}</AuthNotice>}
      <Button type="submit" variant={hasPasskey ? 'secondary' : 'primary'} busy={busy === 'code'} disabled={busy !== null} className={authStyles.fill}>{busy === 'code' ? t.busy : t.submit}</Button>
    </form>
  </AuthShell>;
}
