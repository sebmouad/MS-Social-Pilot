'use client';

import { FormEvent, useState } from 'react';
import { validateFields } from '@/lib/ui/form-validation';

export default function SignIn() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    setMessage('This browser has been signed out.');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const fieldErrors = validateFields(event.currentTarget, {
      email: { empty: 'Enter your email address.', invalid: 'Enter a valid email address.' },
      password: { empty: 'Enter your password.' },
    });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/sign-in', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const result = await response.json() as { next?: string; nextUrl?: string };
      if (!response.ok) {
        setMessage('Sign-in failed. Check your email and password.');
      } else if (result.next === 'verify') {
        window.location.assign('/two-step');
      } else if (result.next === 'enroll') {
        window.location.assign('/two-step/enroll');
      } else {
        window.location.assign(result.nextUrl === '/join' ? '/join' : '/home');
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
    <form method="post" noValidate onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" required maxLength={320} spellCheck={false} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} />
      {errors.email && <p id="email-error" className="auth-field-error">{errors.email}</p>}
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'password-error' : undefined} />
      {errors.password && <p id="password-error" className="auth-field-error">{errors.password}</p>}
      {message && <p role="alert" className="muted">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p><a href="/password-recovery">Forgot your password?</a></p>
    <button type="button" onClick={signOut}>Sign out of this browser</button>
  </div></main>;
}
