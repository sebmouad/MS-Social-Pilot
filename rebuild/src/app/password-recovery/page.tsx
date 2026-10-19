import { PasswordRecoveryForm } from './recovery-form';

export const metadata = { title: 'Password recovery', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

export default function PasswordRecoveryPage() {
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
    <div className="mb-8 text-center">
      <a href="/sign-in" className="text-sm text-slate-600 hover:underline">MS Social Pilot</a>
      <h1 className="mt-5 text-2xl font-semibold text-slate-900">Reset your password</h1>
      <p className="mt-2 text-sm text-slate-600">Request a one-use link or choose a new password from the link in your email.</p>
    </div>
    <PasswordRecoveryForm />
  </main>;
}
