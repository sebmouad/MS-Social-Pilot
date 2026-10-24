import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authLocale } from '@/modules/home/auth/locale';
import { pendingPasskeyAvailable } from '@/server/two-step';
import { VerifyForm } from './verify-form';

export const metadata: Metadata = { title: 'Verify your sign-in', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function VerifySecondStepPage() {
  let hasPasskey = false;
  try { hasPasskey = await pendingPasskeyAvailable(); }
  catch { redirect('/sign-in'); }
  return <VerifyForm hasPasskey={hasPasskey} locale={await authLocale()} />;
}
