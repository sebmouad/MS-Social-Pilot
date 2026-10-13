import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AgentsClient } from '@/components/AgentsClient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { aiAvailable } from '@/lib/ai';
import { listAgents } from '@/lib/ai-agents';
import { requirePage } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('agents.title');
}

/** AI agents: a standing brief that drafts a week of posts on its day. Owners and admins. */
export default async function AgentsPage() {
  const auth = await requirePage();
  if (!canManageSettings(auth.role)) notFound();
  const t = await getTranslations('agents');
  const [agents, pages] = await Promise.all([
    listAgents(auth.workspace.id),
    prisma.target.findMany({ where: { workspaceId: auth.workspace.id }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <AgentsClient
        available={aiAvailable()}
        pages={pages}
        agents={agents.map((a) => ({ id: a.id, targetId: a.targetId, brief: a.brief, weekday: a.weekday, count: a.count, enabled: a.enabled }))}
      />
    </div>
  );
}
