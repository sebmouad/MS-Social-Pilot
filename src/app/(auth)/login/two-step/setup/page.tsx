import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TwoStepEnroll } from '@/components/TwoStepForms';
import { getPendingSession } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { withInviteParam } from '@/lib/invite-path';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('twoStep.setupTitle');
}

/** An account that must have two-step sign-in sets it up before it is let in. */
export default async function TwoStepSetupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const pending = await getPendingSession();
  if (!pending) redirect(withInviteParam('/login', invite));
  if (pending.pending === 'verify') redirect(withInviteParam('/login/two-step', invite));
  const t = await getTranslations('twoStep');

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">{t('setupTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('setupSubtitle')}</p>
      </div>
      <div className="card p-6">
        <TwoStepEnroll inviteToken={invite} />
      </div>
    </div>
  );
}
