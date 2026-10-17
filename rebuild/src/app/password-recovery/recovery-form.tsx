'use client';

import { useEffect, useState, type FormEvent } from 'react';

type Result = { ok: boolean; message?: string; error?: string };
async function post(path: string, value: Record<string, string>): Promise<Result> {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
    return { ok: response.ok, message: body.message, error: body.error };
  } catch { return { ok: false, error: 'The request could not be confirmed. Check your connection and try again.' }; }
}

export function consumeRecoveryFragment(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>): string | null {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function PasswordRecoveryForm() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(consumeRecoveryFragment(window.location, window.history));
    setReady(true);
  }, []);

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    const result = await post('/api/auth/recovery/request', { email });
    setPending(false);
    if (!result.ok) { setError(result.error ?? 'Could not complete that request.'); return; }
    setRequested(true);
  }

  async function setNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) { setPending(false); setError('The passwords do not match.'); return; }
    const result = await post('/api/auth/recovery/reset', { token: token ?? '', password });
    setPending(false);
    if (!result.ok) { setError(result.error ?? 'Could not reset the password.'); return; }
    setToken(null); setReset(true);
  }

  if (!ready) return <div className="card p-6" aria-busy="true">Loading recovery form…</div>;
  if (reset) return <div className="card space-y-4 p-6 text-sm text-slate-700" role="status">
    <p>Your password has been changed and all signed-in sessions have been ended. Sign in again; two-step verification remains required.</p>
    <a href="/sign-in" className="btn-primary inline-flex">Continue to sign in</a>
  </div>;
  if (requested) return <div className="card space-y-4 p-6 text-sm text-slate-700" role="status">
    <p>If an active account matches that address, a recovery link will be sent.</p>
    <a href="/sign-in" className="text-brand-700 hover:underline">Return to sign in</a>
  </div>;

  return token ? <form onSubmit={setNewPassword} className="card space-y-4 p-6">
    <p className="text-sm text-slate-600">Choose a new password. You will need to sign in again after it is changed.</p>
    <div><label className="label" htmlFor="new-password">New password</label><input className="input" id="new-password" name="password" type="password" required maxLength={200} autoComplete="new-password" /></div>
    <div><label className="label" htmlFor="confirm-password">Confirm new password</label><input className="input" id="confirm-password" name="confirm" type="password" required maxLength={200} autoComplete="new-password" /></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <button className="btn-primary w-full" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Set new password'}</button>
  </form> : <form onSubmit={requestLink} className="card space-y-4 p-6">
    <div><label className="label" htmlFor="recovery-email">Email address</label><input className="input" id="recovery-email" name="email" type="email" required maxLength={320} autoComplete="email" /></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <button className="btn-primary w-full" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send recovery link'}</button>
    <a href="/sign-in" className="block text-center text-sm text-brand-700 hover:underline">Return to sign in</a>
  </form>;
}
