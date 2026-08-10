import { Composer } from '@/components/Composer';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { utcToLocalInput } from '@/lib/time';
import { canPublishWithoutApproval } from '@/lib/constants';
import { aiAvailable } from '@/lib/ai';

export const dynamic = 'force-dynamic';

export default async function ComposePage() {
  const auth = await requireAuth();

  const [targets, queueSlots, workspace] = await Promise.all([
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id },
      include: { socialAccount: { select: { name: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.queueSlot.count({ where: { workspaceId: auth.workspace.id } }),
    prisma.workspace.findUniqueOrThrow({
      where: { id: auth.workspace.id },
      select: { aiEnabled: true },
    }),
  ]);

  // One hour out is a friendlier default than "now", and clears Facebook's
  // 10-minute floor for natively scheduled posts.
  const defaultScheduledAt = utcToLocalInput(
    new Date(Date.now() + 60 * 60 * 1000),
    auth.workspace.timezone,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Compose</h1>
        <p className="mt-1 text-sm text-slate-600">
          Write once, publish to any number of Facebook pages and groups.
        </p>
      </header>

      <Composer
        timezone={auth.workspace.timezone}
        hasQueueSlots={queueSlots > 0}
        defaultScheduledAt={defaultScheduledAt}
        aiEnabled={aiAvailable() && workspace.aiEnabled}
        requiresApproval={auth.workspace.requiresApproval}
        canPublishDirectly={canPublishWithoutApproval(auth.role)}
        targets={targets.map((target) => ({
          id: target.id,
          name: target.name,
          type: target.type,
          pictureUrl: target.pictureUrl,
          canPublish: target.canPublish && target.enabled,
          publishBlocker: target.enabled
            ? target.publishBlocker
            : 'Turned off for this workspace.',
          accountName: target.socialAccount?.name ?? null,
        }))}
      />
    </div>
  );
}
