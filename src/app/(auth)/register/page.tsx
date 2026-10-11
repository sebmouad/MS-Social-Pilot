import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { getTranslations } from 'next-intl/server';

import { getAuthContext, mayRegister } from '@/lib/auth';
import { findInvitation } from '@/lib/team';
import { findClientInvitation } from '@/lib/root';
import { afterAuthPath } from '@/lib/invite-path';
import { screenMetadata } from '@/lib/metadata';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('auth.createWorkspace');
}


export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; client?: string }>;
}) {
  const { invite, client } = await searchParams;

  // Already signed in: go straight to the invitation rather than the dashboard,
  // which is where the accept button is.
  if (await getAuthContext()) redirect(afterAuthPath(invite));

  // Say so here rather than letting someone fill the form in and be refused on
  // submit. The API enforces it; this only saves them the typing.
  const invitation = invite ? await findInvitation(invite) : null;
  // Root invited this client to create a workspace of their own.
  const clientInvitation = client ? await findClientInvitation(client) : null;
  const email = invitation?.email ?? clientInvitation?.email ?? '';
  if (!(await mayRegister(email))) {
    return <RegistrationClosed />;
  }

  return (
    <AuthForm
      mode="register"
      inviteToken={invite}
      defaults={clientInvitation ? { email: clientInvitation.email, workspaceName: clientInvitation.workspaceName ?? undefined } : undefined}
    />
  );
}

async function RegistrationClosed() {
  const t = await getTranslations('auth');

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">{t('registrationClosedTitle')}</h1>
      <p className="mt-3 text-sm text-slate-600">{t('registrationClosedBody')}</p>
      <p className="mt-6 text-sm">
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          {t('signIn')}
        </Link>
      </p>
    </div>
  );
}
