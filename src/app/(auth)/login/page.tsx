import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { getAuthContext } from '@/lib/auth';
import { afterAuthPath } from '@/lib/invite-path';
import { isFirstRun } from '@/lib/setup';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;

  // Nobody has registered yet, so there is nothing to sign in to. An invitation
  // still wins: it is a specific instruction, and this is a guess.
  if (!invite && (await isFirstRun())) redirect('/setup');

  // Already signed in: go straight to the invitation rather than the dashboard,
  // which is where the accept button is.
  if (await getAuthContext()) redirect(afterAuthPath(invite));

  return <AuthForm mode="login" inviteToken={invite} />;
}
