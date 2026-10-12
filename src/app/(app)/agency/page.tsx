import { getTranslations } from 'next-intl/server';

import { AgencyClient } from '@/components/AgencyClient';
import { agencyOverview } from '@/lib/agency-access';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('agency.title');
}

/** Every client this person owns, and who on their team reaches which (NEXT_PHASES A7). */
export default async function AgencyPage() {
  const auth = await requirePage();
  const t = await getTranslations('agency');
  const overview = await agencyOverview(auth.user.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>
      {overview.clients.length === 0 ? (
        <p className="card p-8 text-center text-sm text-slate-600">{t('ownersOnly')}</p>
      ) : (
        <AgencyClient clients={overview.clients} people={overview.people} currentId={auth.workspace.id} />
      )}
    </div>
  );
}
