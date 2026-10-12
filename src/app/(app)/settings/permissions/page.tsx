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
        <header>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('workspaceTitle')}</h1>
        </header>
        <p className="card p-8 text-center text-sm text-slate-600">{t('adminsOnly')}</p>
      </div>
    );
  }

  const members = await privilegesByMember({ workspaceId: auth.workspace.id });
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('workspaceTitle')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('workspaceSubtitle')}</p>
      </header>
      <PrivilegesView members={members} showWorkspace={false} />
    </div>
  );
}
