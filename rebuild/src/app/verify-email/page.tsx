import { VerifyEmailForm } from './verify-form';

export const metadata = { title: 'Confirm your email', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

export default function VerifyEmailPage() {
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
    <div className="mb-8 text-center">
      <a href="/sign-in" className="text-sm text-slate-600 hover:underline">MS Social Pilot</a>
      <h1 className="mt-5 text-2xl font-semibold text-slate-900">Confirm your email</h1>
    </div>
    <VerifyEmailForm />
  </main>;
}
