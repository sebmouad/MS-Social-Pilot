import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { getAuthContext } from '@/lib/auth';
import { findInvitation } from '@/lib/team';
import { AcceptInvitation } from '@/components/AcceptInvitation';

export const dynamic = 'force-dynamic';

/**
 * Invitation landing page.
 *
 * Handles three cases: signed in with the right address (accept), signed in
 * with a different one (explain), and signed out (sign in or register first,
 * returning here afterwards).
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('team');
  const tAuth = await getTranslations('auth');

  const invitation = await findInvitation(token);
  const auth = await getAuthContext();

  if (!invitation) {
    return <Shell title={t('acceptInvalid')} />;
  }
  if (invitation.expiresAt < new Date()) {
    return <Shell title={t('acceptExpired')} />;
  }

  const roleLabel = t(`roles.${invitation.role}`);

  if (!auth) {
    return (
      <Shell title={t('acceptTitle', { workspace: invitation.workspaceName })}>
        <p className="mt-3 text-sm text-slate-600">
          {t('acceptBody', { workspace: invitation.workspaceName, role: roleLabel })}
        </p>
        <p className="mt-4 text-sm text-slate-600">{invitation.email}</p>
        <div className="mt-5 flex gap-2">
          {/* The invitation is remembered so the user lands back here. */}
          <Link href={`/register?invite=${token}`} className="btn-primary">
            {tAuth('createOne')}
          </Link>
          <Link href={`/login?invite=${token}`} className="btn-secondary">
            {tAuth('signIn')}
          </Link>
        </div>
      </Shell>
    );
  }

  if (auth.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <Shell title={t('acceptTitle', { workspace: invitation.workspaceName })}>
        <p className="mt-3 text-sm text-amber-700">
          {t('acceptWrongEmail', { email: invitation.email })}
        </p>
      </Shell>
    );
  }

  return (
    <Shell title={t('acceptTitle', { workspace: invitation.workspaceName })}>
      <p className="mt-3 text-sm text-slate-600">
        {t('acceptBody', { workspace: invitation.workspaceName, role: roleLabel })}
      </p>
      <AcceptInvitation token={token} label={t('accept')} />
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card p-8">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
          SP
        </span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{title}</h1>
        {children}
      </div>
    </main>
  );
}
