'use client';

import { FormEvent, useState } from 'react';

export default function VerifySecondStepPage() {
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
  return <main className="auth-screen"><div className="auth-card"><p className="eyebrow">Social Pilot</p><h1>Verify your sign-in</h1><p>Enter a six-digit authenticator code or one of your recovery codes.</p>
    <form onSubmit={submit}><label htmlFor="two-step-code">Verification code</label><input id="two-step-code" name="code" autoComplete="one-time-code" required minLength={6} maxLength={32} />
      {error && <p role="alert" className="muted">{error}</p>}<button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button></form>
    <p className="small-note">If you use a passkey without an authenticator or recovery code, sign in through the current app until passkey verification is available here.</p>
  </div></main>;
}
