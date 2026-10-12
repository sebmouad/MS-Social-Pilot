import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getTranslations } from 'next-intl/server';

import { PrivilegesView } from '@/components/PrivilegesView';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { privilegesByMember } from '@/lib/root';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.privileges.workspaceTitle');
}

/** Read-only: who may do what in this workspace, for its admins. */
export default async function PermissionsPage() {
  const auth = await requirePage();
  const t = await getTranslations('root.privileges');

  if (!auth.isInstanceOwner) {
    return (
      <div className="space-y-6">
        <ScreenHeader title={t('workspaceTitle')} />
        <EmptyState title={t('adminsOnly')} />
      </div>
    );
  }

  const members = await privilegesByMember({ workspaceId: auth.workspace.id });
  return (
    <div className="space-y-6">
      <ScreenHeader title={t('workspaceTitle')} subtitle={t('workspaceSubtitle')} />
      <PrivilegesView members={members} showWorkspace={false} />
    </div>
  );
}
