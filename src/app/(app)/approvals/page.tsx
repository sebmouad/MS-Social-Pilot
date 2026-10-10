import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ApprovalsClient } from '@/components/ApprovalsClient';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { canApprove, canManageOthersPosts, postIsEditable } from '@/lib/constants';
import { IN_APPROVAL_QUEUE } from '@/lib/approvals';
import { parseMedia } from '@/lib/json';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('approvals.title');
}


export default async function ApprovalsPage() {
  const auth = await requirePage();
  // Not an error page: someone without approval rights simply has no business
  // here, so send them somewhere useful.
  if (!canApprove(auth.role)) redirect('/dashboard');

  const t = await getTranslations('approvals');
  const timezone = auth.workspace.timezone;

  const posts = await prisma.post.findMany({
    where: { workspaceId: auth.workspace.id, ...IN_APPROVAL_QUEUE },
    include: {
      targets: { include: { target: { select: { name: true, pictureUrl: true } } } },
      submitter: { select: { name: true } },
      author: { select: { name: true } },
    },
    orderBy: { submittedAt: 'asc' },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <ApprovalsClient
        posts={posts.map((post) => ({
          id: post.id,
          message: post.message,
          firstComment: post.firstComment,
          link: post.link,
          scheduledLabel: post.scheduledAt ? formatInZone(post.scheduledAt, timezone) : null,
          // Worked out here, against the same clock the scheduler reads: a
          // post whose moment has gone publishes as soon as it is approved,
          // and this is the screen where somebody decides that.
          overdue: post.scheduledAt !== null && post.scheduledAt.getTime() <= Date.now(),
          submittedBy: post.submitter?.name ?? post.author.name,
          submittedLabel: post.submittedAt ? formatInZone(post.submittedAt, timezone) : null,
          targets: post.targets.map((postTarget) => postTarget.target.name),
          pictureUrl: post.targets[0]?.target.pictureUrl ?? null,
          // What is actually going out, not a count of it: a reviewer
          // signing off on a caption has to see the picture it sits under.
          media: parseMedia(post.media).map((item) => ({
            id: item.id,
            kind: item.kind,
            url: item.url,
            altText: item.altText ?? null,
          })),
          // Reviewers may fix a typo themselves rather than bounce the whole
          // post back. With review on, an edit to a waiting post keeps it
          // waiting (`reviewAfterEdit` in lib/posts), so it comes back here.
          editable: canManageOthersPosts(auth.role) && postIsEditable(post),
        }))}
      />
    </div>
  );
}
