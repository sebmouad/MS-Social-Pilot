import { redirect } from 'next/navigation';
import { pendingPasskeyAvailable } from '@/server/two-step';
import { VerifyForm } from './verify-form';

export default async function VerifySecondStepPage() {
  let hasPasskey = false;
  try { hasPasskey = await pendingPasskeyAvailable(); }
  catch { redirect('/sign-in'); }
  return <VerifyForm hasPasskey={hasPasskey} />;
}
