import { registrationAvailable } from '@/modules/settings/server/registration';
import { SignUpForm } from './sign-up-form';

export const metadata = { title: 'Create your account', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const open = await registrationAvailable();
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
    <div className="mb-8 text-center">
      <a href="/sign-in" className="text-sm text-slate-600 hover:underline">MS Social Pilot</a>
      <h1 className="mt-5 text-2xl font-semibold text-slate-900">{open ? 'Create your account' : 'Sign-up is closed'}</h1>
      <p className="mt-2 text-sm text-slate-600">{open ? 'You will get your own workspace once you confirm your email.' : 'Ask a workspace owner to invite you, or sign in if you already have an account.'}</p>
    </div>
    {open ? <SignUpForm /> : <a href="/sign-in" className="btn-primary w-full text-center">Go to sign in</a>}
  </main>;
}
