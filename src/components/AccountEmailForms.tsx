'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Email-link screens (S3): forgot password, choose a new one, resend the confirmation. */

async function post(url: string, body?: unknown): Promise<{ ok: boolean; error?: string; fields?: Record<string, string> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).catch(() => null);
  const json = (await response?.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> } | undefined;
  return { ok: Boolean(response?.ok), error: json?.error, fields: json?.fields };
}

function useReady(): boolean {
  // The submit button waits for hydration, so a click never sends the form as a GET.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

export function ForgotPasswordForm() {
  const t = useTranslations('accountEmail');
  const ready = useReady();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await post('/api/auth/password-reset', { email: new FormData(event.currentTarget).get('email') });
    setPending(false);
    if (!result.ok) return setError(result.fields?.email ?? result.error ?? t('failed'));
    setSent(true);
  }

  if (sent) {
    return (
      <div role="status" className="card p-6 text-sm text-slate-700">
        {t('resetSent')}
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} method="post" className="card space-y-4 p-6">
      <div>
        <label className="label" htmlFor="email">{t('email')}</label>
        <input id="email" name="email" type="email" className="input" required autoComplete="email" />
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <button type="submit" className="btn-primary w-full" disabled={pending || !ready}>
        {pending ? t('sending') : t('sendResetLink')}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('accountEmail');
  const ready = useReady();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirm')) return setError(t('mismatch'));
    setPending(true);
    setError(null);
    const result = await post('/api/auth/password-reset/confirm', { token, password: form.get('password') });
    setPending(false);
    if (!result.ok) return setError(result.fields?.password ?? result.error ?? t('failed'));
    setDone(true);
  }

  if (done) {
    return (
      <div role="status" className="card space-y-3 p-6 text-sm text-slate-700">
        <p>{t('resetDone')}</p>
        <Link href="/login" className="btn-primary inline-flex">{t('signIn')}</Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} method="post" className="card space-y-4 p-6">
      <div>
        <label className="label" htmlFor="password">{t('newPassword')}</label>
        <input id="password" name="password" type="password" className="input" required minLength={10} autoComplete="new-password" />
        <p className="hint">{t('passwordHint')}</p>
      </div>
      <div>
        <label className="label" htmlFor="confirm">{t('confirmPassword')}</label>
        <input id="confirm" name="confirm" type="password" className="input" required autoComplete="new-password" />
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <button type="submit" className="btn-primary w-full" disabled={pending || !ready}>
        {pending ? t('saving') : t('setPassword')}
      </button>
    </form>
  );
}

export function ResendVerification() {
  const t = useTranslations('accountEmail');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function resend() {
    setPending(true);
    setMessage(null);
    const result = await post('/api/auth/verify-email');
    setPending(false);
    setMessage(result.ok ? { ok: true, text: t('resent') } : { ok: false, text: result.error ?? t('failed') });
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn-secondary" disabled={pending} onClick={resend}>
        {pending ? t('sending') : t('resend')}
      </button>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export function SignOutLink() {
  const t = useTranslations('accountEmail');
  async function signOut() {
    await post('/api/auth/logout');
    window.location.assign('/login');
  }
  return (
    <button type="button" className="text-sm font-medium text-brand-600 hover:underline" onClick={signOut}>
      {t('signOut')}
    </button>
  );
}
