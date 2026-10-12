import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ResetPasswordForm } from '@/components/AccountEmailForms';
import { screenMetadata } from '@/lib/metadata';

export function generateMetadata() {
  return screenMetadata('accountEmail.resetTitle');
}

/** Opened from the reset email (S3). The token is checked when the form is sent. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = await getTranslations('accountEmail');
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">{t('resetTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{token ? t('resetBody') : t('noToken')}</p>
      </div>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline">{t('askAgain')}</Link>
        </p>
      )}
    </div>
  );
}
