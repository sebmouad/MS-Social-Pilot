'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { FormEvent, useState } from 'react';

export function VerifyForm({ hasPasskey }: { hasPasskey: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/two-step/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: form.get('code') }) });
      if (response.ok) window.location.assign('/home');
      else setError(response.status === 429 ? 'Too many attempts. Try again later.' : 'The code was not accepted. Check your authenticator or use a recovery code.');
    } catch { setError('Verification is temporarily unavailable.'); }
    finally { setBusy(false); }
  }
  async function verifyPasskey() {
    setBusy(true);
    setError('');
    try {
      const start = await fetch('/api/auth/passkey/options', { method: 'POST' });
      if (!start.ok) throw new Error(start.status === 429 ? 'Too many attempts. Try again later.' : 'Passkey verification is unavailable. Use a code or try again.');
      const data = await start.json() as { options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };
      const response = await startAuthentication({ optionsJSON: data.options });
      const finish = await fetch('/api/auth/passkey/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response }) });
      if (!finish.ok) throw new Error(finish.status === 429 ? 'Too many attempts. Try again later.' : 'The passkey could not be verified. Try again or use a code.');
      window.location.assign('/home');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Passkey verification was cancelled.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-screen"><div className="auth-card"><p className="eyebrow">Social Pilot</p><h1>Verify your sign-in</h1><p>Use a passkey, six-digit authenticator code, or recovery code.</p>
    {hasPasskey && <button type="button" disabled={busy} onClick={verifyPasskey}>Use a passkey</button>}
    <form onSubmit={submit}><label htmlFor="two-step-code">Verification code</label><input id="two-step-code" name="code" autoComplete="one-time-code" required minLength={6} maxLength={32} />
      {error && <p role="alert" className="muted">{error}</p>}<button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button></form>
  </div></main>;
}
