'use client';

import { useState, type FormEvent } from 'react';

export function SignUpForm() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) { setError('The passwords do not match.'); return; }
    setPending(true);
    try {
      const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ name: String(form.get('name') ?? ''), email: String(form.get('email') ?? ''), password }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error ?? 'Could not create your account. Try again.'); return; }
      setDone(true);
    } catch { setError('The request could not be confirmed. Check your connection and try again.'); }
    finally { setPending(false); }
  }

  if (done) return <div className="card space-y-4 p-6 text-sm text-slate-700" role="status">
    <p>Check your email. We sent a link to confirm your address and create your workspace. The link works once.</p>
    <a href="/verify-email" className="text-brand-700 hover:underline">Didn’t get it? Send a new link</a>
  </div>;

  return <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
    <div><label className="label" htmlFor="signup-name">Your name</label><input className="input" id="signup-name" name="name" required maxLength={120} autoComplete="name" /></div>
    <div><label className="label" htmlFor="signup-email">Email address</label><input className="input" id="signup-email" name="email" type="email" required maxLength={320} autoComplete="email" /></div>
    <div><label className="label" htmlFor="signup-password">Password</label><input className="input" id="signup-password" name="password" type="password" required maxLength={200} autoComplete="new-password" /></div>
    <div><label className="label" htmlFor="signup-confirm">Confirm password</label><input className="input" id="signup-confirm" name="confirm" type="password" required maxLength={200} autoComplete="new-password" /></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <button className="btn-primary w-full" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create account'}</button>
    <a href="/sign-in" className="block text-center text-sm text-brand-700 hover:underline">I already have an account</a>
  </form>;
}
