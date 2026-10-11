import { getTranslations } from 'next-intl/server';

import { WorkspacesTable } from '@/components/RootClient';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { listWorkspaces } from '@/lib/root';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.workspaces.title');
}

export default async function RootWorkspacesPage() {
  await requireRoot();
  const t = await getTranslations('root');
  const workspaces = await listWorkspaces();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('workspaces.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('workspaces.subtitle', { count: workspaces.length })}</p>
      </header>
      <WorkspacesTable workspaces={workspaces} />
    </div>
  );
}
