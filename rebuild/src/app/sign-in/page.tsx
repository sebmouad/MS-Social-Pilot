import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Sign in' };
export default function SignIn() {
  return <main className="auth-screen"><div className="auth-card"><p className="eyebrow">Social Pilot</p><h1>Sign in to your workspace</h1><p>Your existing account and data will be available in the rebuilt app. Sign-in is being connected before launch.</p><p className="muted">This preview does not accept passwords yet.</p></div></main>;
}
