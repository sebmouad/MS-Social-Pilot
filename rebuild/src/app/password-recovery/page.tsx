import { authLocale } from '@/modules/home/auth/locale';
import { PasswordRecoveryForm } from './recovery-form';

export const metadata = { title: 'Password recovery', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export const dynamic = 'force-dynamic';

export default async function PasswordRecoveryPage() {
  return <PasswordRecoveryForm locale={await authLocale()} />;
}
