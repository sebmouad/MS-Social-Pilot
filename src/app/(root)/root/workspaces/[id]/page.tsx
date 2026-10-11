import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { Icon } from '@/components/Icon';
import { WorkspaceDetail } from '@/components/RootClient';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { MODULE_KEYS } from '@/lib/modules';
import { workspaceDetail } from '@/lib/root';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.workspace.title');
}

/** One client's workspace, as root runs it: access, modules, members. */
export default async function RootWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await params;
  const workspace = await workspaceDetail(id);
  if (!workspace) notFound();
  const t = await getTranslations('root');
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <header>
        <Link href="/root/workspaces" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
          <Icon name="chevronLeft" size={14} /> {t('workspaces.title')}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">{workspace.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('workspace.summary', {
            pages: workspace.pages,
            posts: workspace.posts,
            created: format.dateTime(new Date(workspace.createdAt), { dateStyle: 'medium' }),
          })}
        </p>
      </header>
      <WorkspaceDetail workspace={workspace} moduleKeys={MODULE_KEYS} />
    </div>
  );
}
