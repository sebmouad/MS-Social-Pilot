import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { getAuthContext, mayRegister } from '@/lib/auth';

import { afterAuthPath, RETURN_COOKIE } from '@/lib/invite-path';
import { isFirstRun } from '@/lib/setup';
import { findInvitation } from '@/lib/team';
import { screenMetadata } from '@/lib/metadata';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('auth.signIn');
}


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
  if (await getAuthContext()) redirect(afterAuthPath(invite, (await cookies()).get(RETURN_COOKIE)?.value ?? ''));

  const invitation = invite ? await findInvitation(invite) : null;
  const registrationAllowed = await mayRegister(invitation?.email ?? '');
  return <AuthForm mode="login" inviteToken={invite} registrationAllowed={registrationAllowed} />;
}
