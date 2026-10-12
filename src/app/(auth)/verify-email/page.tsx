import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ResendVerification, SignOutLink } from '@/components/AccountEmailForms';
import { getAuthContext } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';

export function generateMetadata() {
  return screenMetadata('accountEmail.verifyTitle');
}

/** Where a self-service sign-up waits until the emailed link is opened (S3). */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  const { failed } = await searchParams;
  const auth = await getAuthContext();
  const t = await getTranslations('accountEmail');
  if (auth?.user.emailVerified) redirect('/dashboard');
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <div className="card space-y-4 p-6">
        <h1 className="text-xl font-semibold text-slate-900">{t('verifyTitle')}</h1>
        {failed && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {t('verifyFailed')}
          </p>
        )}
        {auth ? (
          <>
            <p className="text-sm text-slate-700">{t('verifyBody', { email: auth.user.email })}</p>
            <ResendVerification />
            <SignOutLink />
          </>
        ) : (
          <p className="text-sm text-slate-700">
            {t('verifySignedOut')}{' '}
            <a href="/login" className="font-medium text-brand-600 hover:underline">{t('signIn')}</a>
          </p>
        )}
      </div>
    </div>
  );
}
