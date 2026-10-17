import type { Metadata } from 'next';
import { accountPasswordPolicy } from '@/server/account-settings';
import { JoinForm } from './join-form';
export const metadata: Metadata = { title: 'Join a workspace', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function JoinPage() {
  const passwordPolicy = await accountPasswordPolicy();
  return <JoinForm passwordPolicy={passwordPolicy} />;
}
