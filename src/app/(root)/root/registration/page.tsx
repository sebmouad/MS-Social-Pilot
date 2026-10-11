import { getTranslations } from 'next-intl/server';

import { InvitationsTable, RegistrationSwitch } from '@/components/RootClient';
import { requireRoot } from '@/lib/auth';
import { env } from '@/lib/env';
import { screenMetadata } from '@/lib/metadata';
import { listInvitations } from '@/lib/root';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.registration.title');
}

export default async function RootRegistrationPage() {
  await requireRoot();
  const t = await getTranslations('root');
  const invitations = await listInvitations();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('registration.title')}</h1>
      </header>
      <section className="card p-4 sm:p-5">
        <RegistrationSwitch open={env.openRegistration} />
      </section>
      <section className="card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('registration.invitations', { count: invitations.length })}</h2>
        <InvitationsTable invitations={invitations} />
      </section>
    </div>
  );
}
