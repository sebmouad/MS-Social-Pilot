import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadSelection } from '@/lib/page-filter';
import { ChannelsLayout } from '@/components/ChannelsLayout';

import Link from 'next/link';

import { ApprovalsClient } from '@/components/ApprovalsClient';
import { ApprovalBoard, type BoardCard } from '@/components/ApprovalBoard';
import { listLabels } from '@/lib/page-groups';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { postScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { canApprove, canManageOthersPosts, postIsEditable } from '@/lib/constants';
import { IN_APPROVAL_QUEUE } from '@/lib/approvals';
import { feedLinkOf } from '@/lib/feed';
import { parseMedia } from '@/lib/json';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('approvals.title');
}


export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const params = await searchParams;
  // Follows the shared profile selection (src/lib/page-filter.ts).
  const selection = await loadSelection(auth, params);
  const pageScope = selection.scope;
  const board = (Array.isArray(params.view) ? params.view[0] : params.view) === 'board';
  // Not an error page: someone without approval rights simply has no business
  // here, so send them somewhere useful.
  if (!canApprove(auth.role)) redirect('/dashboard');

  const t = await getTranslations('approvals');
  const timezone = auth.workspace.timezone;

  const posts = await prisma.post.findMany({
    where: { workspaceId: auth.workspace.id, ...postScope(pageScope), ...IN_APPROVAL_QUEUE },
    include: {
      targets: { include: { target: { select: { name: true, pictureUrl: true } } } },
      submitter: { select: { name: true } },
      author: { select: { name: true } },
    },
    orderBy: { submittedAt: 'asc' },
  });

  const tabs = (
    <nav className="segmented" aria-label={t('viewLabel')}>
      {[
        { key: 'review', href: '/approvals', label: t('viewReview') },
        { key: 'board', href: '/approvals?view=board', label: t('viewBoard') },
      ].map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={(tab.key === 'board') === board ? 'page' : undefined}
          className={`segmented-item ${(tab.key === 'board') === board ? 'segmented-item-active' : ''}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );

  if (board) {
    const labels = await listLabels(auth.workspace.id);
    const labelById = new Map(labels.map((label) => [label.id, label]));
    const include = {
      targets: { include: { target: { select: { name: true, pictureUrl: true } } } },
      labels: { select: { labelId: true } },
      reviewDecisions: { select: { decision: true } },
    } as const;
    const take = 40;
    const [drafts, ready, rejected] = await Promise.all([
      prisma.post.findMany({ where: { workspaceId: auth.workspace.id, ...postScope(pageScope), status: 'draft' }, include, orderBy: { updatedAt: 'desc' }, take }),
      prisma.post.findMany({
        where: { workspaceId: auth.workspace.id, ...postScope(pageScope), status: 'scheduled', approvalStatus: 'approved', scheduledAt: { gte: new Date() } },
        include,
        orderBy: { scheduledAt: 'asc' },
        take,
      }),
      prisma.post.findMany({ where: { workspaceId: auth.workspace.id, ...postScope(pageScope), status: 'rejected' }, include, orderBy: { updatedAt: 'desc' }, take }),
    ]);
    const pending = await prisma.post.findMany({
      where: { workspaceId: auth.workspace.id, ...postScope(pageScope), ...IN_APPROVAL_QUEUE },
      include,
      orderBy: { submittedAt: 'asc' },
    });
    const card = (post: (typeof drafts)[number]): BoardCard => ({
      id: post.id,
      message: post.message,
      pages: post.targets.map((row) => row.target),
      when: post.scheduledAt ? formatInZone(post.scheduledAt, timezone, 'EEE d MMM, HH:mm') : null,
      imageUrl: parseMedia(post.media).find((item) => item.kind === 'image')?.url ?? null,
      href: postIsEditable(post) ? `/compose?post=${post.id}` : '/posts',
      labels: post.labels.flatMap((row) => (labelById.get(row.labelId) ? [labelById.get(row.labelId)!] : [])),
      feedback: {
        approved: post.reviewDecisions.filter((row) => row.decision === 'approved').length,
        rejected: post.reviewDecisions.filter((row) => row.decision === 'rejected').length,
        comments: post.reviewDecisions.filter((row) => row.decision === 'comment').length,
      },
    });
    return (
      <ChannelsLayout auth={auth} selection={selection}>
      <div className="min-w-0 flex-1 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
            <p className="mt-1 text-sm text-slate-600">{t('boardSubtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tabs}
          </div>
        </header>
        <ApprovalBoard
          noText={t('noText')}
          columns={[
            { key: 'draft', title: t('colDraft'), hint: t('colDraftHint'), tone: 'bg-slate-400', cards: drafts.map(card), empty: t('colEmpty') },
            { key: 'pending', title: t('colPending'), hint: t('colPendingHint'), tone: 'bg-violet-500', cards: pending.map(card), empty: t('colEmpty') },
            { key: 'ready', title: t('colReady'), hint: t('colReadyHint'), tone: 'bg-emerald-500', cards: ready.map(card), empty: t('colEmpty') },
            { key: 'rejected', title: t('colRejected'), hint: t('colRejectedHint'), tone: 'bg-rose-500', cards: rejected.map(card), empty: t('colEmpty') },
          ]}
        />
      </div>
      </ChannelsLayout>
    );
  }

  return (
    <ChannelsLayout auth={auth} selection={selection}>
    <div className="min-w-0 flex-1 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('countLine', { count: posts.length, profiles: selection.ids.length })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tabs}
        </div>
      </header>

      <ApprovalsClient
        posts={posts.map((post) => ({
          id: post.id,
          message: post.message,
          firstComment: post.firstComment,
          link: post.link,
          linkPreview: feedLinkOf(post.linkPreview),
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
    </ChannelsLayout>
  );
}
