import { authLocale } from '@/modules/home/auth/locale';
import { VerifyEmailForm } from './verify-form';

export const metadata = { title: 'Confirm your email', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage() {
  return <VerifyEmailForm locale={await authLocale()} />;
}
