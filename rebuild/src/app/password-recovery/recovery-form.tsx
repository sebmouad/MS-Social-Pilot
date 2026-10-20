'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { validateFields } from '@/lib/ui/form-validation';
import { AuthField, AuthNotice, AuthShell, AuthStatus, authStyles } from '@/modules/home/auth/AuthShell';
import { authCopy, type AuthLocale } from '@/modules/home/auth/copy';

type Result = { ok: boolean; message?: string; error?: string; status?: number };
async function post(path: string, value: Record<string, string>): Promise<Result> {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
    return { ok: response.ok, message: body.message, error: body.error, status: response.status };
  } catch { return { ok: false }; }
}

export function consumeRecoveryFragment(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>): string | null {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function PasswordRecoveryForm({ locale = 'en' }: { locale?: AuthLocale }) {
  const copy = authCopy(locale);
  const t = copy.recovery;
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setToken(consumeRecoveryFragment(window.location, window.history));
    setReady(true);
  }, []);

  const failure = (result: Result, fallback: string) => result.status === 429 ? copy.tooMany : result.status === undefined ? copy.offline : result.error ?? fallback;

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const fieldErrors = validateFields(event.currentTarget, { email: { empty: t.emailEmpty, invalid: t.emailInvalid } });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setPending(true);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    const result = await post('/api/auth/recovery/request', { email });
    setPending(false);
    if (!result.ok) { setError(failure(result, t.requestFailed)); return; }
    setRequested(true);
  }

  async function setNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const fieldErrors = validateFields(event.currentTarget, { password: { empty: t.passwordEmpty }, confirm: { empty: t.confirmEmpty } });
    if (!fieldErrors.confirm && !fieldErrors.password && password !== String(form.get('confirm') ?? '')) fieldErrors.confirm = t.mismatch;
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setPending(true);
    const result = await post('/api/auth/recovery/reset', { token: token ?? '', password });
    setPending(false);
    if (!result.ok) { setError(failure(result, t.resetFailed)); return; }
    setToken(null); setReset(true);
  }

  if (!ready) return <AuthShell title={t.title}><AuthStatus>{t.loading}</AuthStatus></AuthShell>;
  if (reset) return <AuthShell title={t.doneTitle}>
    <AuthNotice tone="success">{t.done}</AuthNotice>
    <a className="ui-button ui-button--primary" href="/sign-in">{t.continue}</a>
  </AuthShell>;
  if (requested) return <AuthShell title={t.sentTitle}>
    <AuthNotice tone="success">{t.sent}</AuthNotice>
    <p className={authStyles.links}><a href="/sign-in">{copy.backToSignIn}</a></p>
  </AuthShell>;

  return <AuthShell title={t.title} lead={token ? t.resetLead : t.requestLead} footer={token ? undefined : <a className={authStyles.linkButton} href="/sign-in">{copy.backToSignIn}</a>}>
    {token ? <form className={authStyles.form} method="post" noValidate onSubmit={setNewPassword}>
      <AuthField id="new-password" name="password" type="password" label={t.password} required maxLength={200} autoComplete="new-password" error={errors.password} disabled={pending} />
      <AuthField id="confirm-password" name="confirm" type="password" label={t.confirm} required maxLength={200} autoComplete="new-password" error={errors.confirm} disabled={pending} />
      {error && <AuthNotice>{error}</AuthNotice>}
      <Button type="submit" variant="primary" busy={pending} className={authStyles.fill}>{pending ? t.saving : t.save}</Button>
    </form> : <form className={authStyles.form} method="post" noValidate onSubmit={requestLink}>
      <AuthField id="recovery-email" name="email" type="email" label={t.email} required maxLength={320} autoComplete="email" spellCheck={false} error={errors.email} disabled={pending} />
      {error && <AuthNotice>{error}</AuthNotice>}
      <Button type="submit" variant="primary" busy={pending} className={authStyles.fill}>{pending ? t.sending : t.send}</Button>
    </form>}
  </AuthShell>;
}
