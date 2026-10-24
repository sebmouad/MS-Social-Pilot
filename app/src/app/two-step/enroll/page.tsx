import type { Metadata } from 'next';
import { authLocale } from '@/modules/home/auth/locale';
import EnrollSecondStepPage from './enroll-form';
import { postAuthenticationPath } from '@/server/invitation-session';

export const metadata: Metadata = { title: 'Protect your account', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function EnrollSecondStepRoute() {
  return <EnrollSecondStepPage continuePath={await postAuthenticationPath()} locale={await authLocale()} />;
}
