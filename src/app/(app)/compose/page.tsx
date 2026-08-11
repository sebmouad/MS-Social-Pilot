import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { Composer, type EditingPost } from '@/components/Composer';
import { requirePage } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseMedia } from '@/lib/json';
import { utcToLocalInput } from '@/lib/time';
import { postIsEditable, canManageOthersPosts, canPublishWithoutApproval } from '@/lib/constants';
import { aiAvailable } from '@/lib/ai';

export const dynamic = 'force-dynamic';

/**
 * Write a post, or change one that has not gone out yet.
 *
 * `?post=<id>` turns this into an edit screen. It is the same screen
 * deliberately: everything you can say when writing a post you can also say
 * when correcting one, and a separate, smaller edit form would quietly be
 * missing something.
 */
export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('compose');
  const params = await searchParams;
  const postId = Array.isArray(params.post) ? params.post[0] : params.post;

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

  const editing = postId ? await loadForEditing(postId, auth) : null;
  // A link to a post that is gone, belongs to another client, or has already
  // been published is a 404 rather than a blank composer — silently opening an
  // empty form would lose the edit without saying so.
  if (postId && !editing) notFound();

  // One hour out is a friendlier default than "now", and clears Facebook's
  // 10-minute floor for natively scheduled posts.
  const defaultScheduledAt = utcToLocalInput(
    new Date(Date.now() + 60 * 60 * 1000),
    auth.workspace.timezone,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">
          {editing ? t('editTitle') : t('title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {editing ? t('editSubtitle') : t('subtitle')}
        </p>
      </header>

      <Composer
        timezone={auth.workspace.timezone}
        hasQueueSlots={queueSlots > 0}
        defaultScheduledAt={defaultScheduledAt}
        aiEnabled={aiAvailable() && workspace.aiEnabled}
        requiresApproval={auth.workspace.requiresApproval}
        canPublishDirectly={canPublishWithoutApproval(auth.role)}
        {...(editing ? { editing } : {})}
        targets={targets.map((target) => ({
          id: target.id,
          name: target.name,
          type: target.type,
          pictureUrl: target.pictureUrl,
          canPublish: target.canPublish && target.enabled,
          publishBlocker: target.enabled ? target.publishBlocker : t('targetPaused'),
          accountName: target.socialAccount?.name ?? null,
        }))}
      />
    </div>
  );
}

type Auth = Awaited<ReturnType<typeof requirePage>>;

/**
 * The post behind `?post=`, or null if this person may not edit it.
 *
 * Every reason to refuse is folded into one null: the workspace scope, the
 * contributor rule about other people's work, and the lifecycle rule that a
 * published post cannot be rewritten. The API applies all three again on save
 * — this only decides whether to put the form on screen.
 */
async function loadForEditing(postId: string, auth: Auth): Promise<EditingPost | null> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: auth.workspace.id },
    include: { targets: { select: { targetId: true, status: true } } },
  });
  if (!post) return null;

  if (post.authorId !== auth.user.id && !canManageOthersPosts(auth.role)) return null;
  if (!postIsEditable(post)) return null;

  return {
    id: post.id,
    message: post.message,
    link: post.link,
    media: parseMedia(post.media),
    targetIds: post.targets.map((target) => target.targetId),
    scheduledAtLocal: post.scheduledAt
      ? utcToLocalInput(post.scheduledAt, post.timezone || auth.workspace.timezone)
      : null,
    publishMode: post.publishMode,
  };
}
