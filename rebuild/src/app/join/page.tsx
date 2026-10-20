import type { Metadata } from 'next';
import { authLocale } from '@/modules/home/auth/locale';
import { accountPasswordPolicy } from '@/server/account-settings';
import { JoinForm } from './join-form';
export const metadata: Metadata = { title: 'Join a workspace', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function JoinPage() {
  const [passwordPolicy, locale] = await Promise.all([accountPasswordPolicy(), authLocale()]);
  return <JoinForm passwordPolicy={passwordPolicy} locale={locale} />;
}
