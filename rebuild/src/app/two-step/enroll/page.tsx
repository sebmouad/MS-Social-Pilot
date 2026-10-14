'use client';

import { FormEvent, useState } from 'react';

export default function EnrollSecondStepPage() {
  const [secret, setSecret] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function begin() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/two-step/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'begin' }) });
      const result = await response.json();
      if (!response.ok) throw new Error();
      setSecret(result.secret);
    } catch { setError('Setup could not start. Sign in again and retry.'); }
    finally { setBusy(false); }
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/two-step/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'confirm', code: form.get('code') }) });
      const result = await response.json();
      if (!response.ok) throw new Error();
      setCodes(result.recoveryCodes);
      setSecret('');
    } catch { setError('The code was not accepted. Check your authenticator and try again.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-screen"><div className="auth-card"><p className="eyebrow">Social Pilot</p><h1>Protect your account</h1>
    {codes.length ? <><p>Save these recovery codes somewhere private. Each code works once. They will not be shown again.</p><ul>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><a href="/home">I have saved my codes — continue</a></> : secret ? <><p>Add this setup key to your authenticator app, then enter its six-digit code.</p><p className="setup-secret"><code>{secret}</code></p><form onSubmit={confirm}><label htmlFor="setup-code">Authenticator code</label><input id="setup-code" name="code" autoComplete="one-time-code" required minLength={6} maxLength={6} /><button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Finish setup'}</button></form></> : <><p>Your account requires an authenticator before this preview can open.</p><button type="button" onClick={begin} disabled={busy}>{busy ? 'Starting…' : 'Set up authenticator'}</button></>}
    {error && <p role="alert" className="muted">{error}</p>}
  </div></main>;
}
