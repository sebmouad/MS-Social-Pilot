import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TwoStepVerify } from '@/components/TwoStepForms';
import { getPendingSession } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { withInviteParam } from '@/lib/invite-path';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('twoStep.title');
}

/** The second step of signing in. Only reachable between the password and the code. */
export default async function TwoStepPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const pending = await getPendingSession();
  if (!pending) redirect(withInviteParam('/login', invite));
  if (pending.pending === 'enroll') redirect(withInviteParam('/login/two-step/setup', invite));
  const t = await getTranslations('twoStep');

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('subtitle', { email: pending.user.email })}</p>
      </div>
      <div className="card p-6">
        <TwoStepVerify
          hasTotp={Boolean(pending.user.totpEnabledAt)}
          hasPasskey={pending.user._count.passkeys > 0}
          inviteToken={invite}
        />
      </div>
    </div>
  );
}
