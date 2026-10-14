'use client';

import { FormEvent, useState } from 'react';

export default function SignIn() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    setMessage('This browser has been signed out.');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/sign-in', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const result = await response.json();
      if (result.code === 'SECOND_FACTOR_REQUIRED') {
        setMessage('This account requires a second factor. The rebuild cannot verify TOTP, passkeys, or recovery codes yet. Use the existing app to sign in.');
      } else if (!response.ok) {
        setMessage('Sign-in failed. Check your email and password.');
      } else {
        window.location.assign('/home');
      }
    } catch {
      setMessage('Sign-in is temporarily unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen"><div className="auth-card">
    <p className="eyebrow">Social Pilot</p><h1>Sign in to your workspace</h1>
    <p>Use your existing Social Pilot account.</p>
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" required maxLength={320} />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
      {message && <p role="alert" className="muted">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <button type="button" onClick={signOut}>Sign out of this browser</button>
  </div></main>;
}
