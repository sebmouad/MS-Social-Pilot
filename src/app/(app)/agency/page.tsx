import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getTranslations } from 'next-intl/server';

import { AgencyClient } from '@/components/AgencyClient';
import { agencyOverview } from '@/lib/agency-access';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('agency.title');
}

/** Every client this person owns, and who on their team reaches which. */
export default async function AgencyPage() {
  const auth = await requirePage();
  const t = await getTranslations('agency');
  const overview = await agencyOverview(auth.user.id);

  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      {overview.clients.length === 0 ? (
        <EmptyState title={t('ownersOnly')} />
      ) : (
        <AgencyClient clients={overview.clients} people={overview.people} currentId={auth.workspace.id} />
      )}
    </div>
  );
}
