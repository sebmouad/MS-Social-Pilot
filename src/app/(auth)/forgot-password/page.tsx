import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ForgotPasswordForm } from '@/components/AccountEmailForms';
import { emailEnabled } from '@/lib/email/send';
import { screenMetadata } from '@/lib/metadata';

export function generateMetadata() {
  return screenMetadata('accountEmail.forgotTitle');
}

/** "Forgot your password?" (S3): a link by email, when the server can send one. */
export default async function ForgotPasswordPage() {
  const t = await getTranslations('accountEmail');
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">{t('forgotTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{emailEnabled() ? t('forgotBody') : t('noEmail')}</p>
      </div>
      {emailEnabled() && <ForgotPasswordForm />}
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-brand-600 hover:underline">{t('backToSignIn')}</Link>
      </p>
    </div>
  );
}
