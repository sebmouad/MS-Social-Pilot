import { authLocale } from '@/modules/home/auth/locale';
import { registrationAvailable } from '@/modules/settings/server/registration';
import { SignUpForm } from './sign-up-form';

export const metadata = { title: 'Create your account', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const [open, locale] = await Promise.all([registrationAvailable(), authLocale()]);
  return <SignUpForm open={open} locale={locale} />;
}
