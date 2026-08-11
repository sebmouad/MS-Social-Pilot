import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { getAuthContext } from '@/lib/auth';
import { afterAuthPath } from '@/lib/invite-path';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;

  // Already signed in: go straight to the invitation rather than the dashboard,
  // which is where the accept button is.
  if (await getAuthContext()) redirect(afterAuthPath(invite));

  return <AuthForm mode="login" inviteToken={invite} />;
}
