'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { consumeRecoveryFragment } from '../password-recovery/recovery-form';

type State = 'loading' | 'confirming' | 'confirmed' | 'failed' | 'resend' | 'resent';

/** Reads the one-use token from the URL fragment (never sent to the server in the request line), then confirms it once. */
export function VerifyEmailForm() {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
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
        if (!response.ok) { setError(body.error ?? 'This confirmation link is invalid or has expired.'); setState('failed'); return; }
        setState('confirmed');
      } catch { setError('The request could not be confirmed. Check your connection and try again.'); setState('failed'); }
    })();
  }, []);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    try {
      const response = await fetch('/api/auth/verify-email/resend', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ email: String(new FormData(event.currentTarget).get('email') ?? '') }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error ?? 'Could not send a new link.'); return; }
      setState('resent');
    } catch { setError('The request could not be confirmed. Check your connection and try again.'); }
    finally { setPending(false); }
  }

  if (state === 'loading' || state === 'confirming') return <div className="card p-6 text-sm text-slate-700" aria-busy="true" role="status">Confirming your email…</div>;
  if (state === 'confirmed') return <div className="card space-y-4 p-6 text-sm text-slate-700" role="status">
    <p>Your email is confirmed and your workspace is ready.</p>
    <a href="/sign-in" className="btn-primary inline-flex">Continue to sign in</a>
  </div>;
  if (state === 'resent') return <div className="card space-y-4 p-6 text-sm text-slate-700" role="status">
    <p>If an unconfirmed account matches that address, a new link will be sent.</p>
    <a href="/sign-in" className="text-brand-700 hover:underline">Return to sign in</a>
  </div>;
  return <form onSubmit={resend} className="card space-y-4 p-6">
    {state === 'failed' && error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <p className="text-sm text-slate-600">Enter your email to get a new confirmation link.</p>
    <div><label className="label" htmlFor="verify-email">Email address</label><input className="input" id="verify-email" name="email" type="email" required maxLength={320} autoComplete="email" /></div>
    {state !== 'failed' && error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <button className="btn-primary w-full" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send a new link'}</button>
  </form>;
}
