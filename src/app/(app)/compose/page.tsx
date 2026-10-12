import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { TargetType } from '@prisma/client';

import { Composer, type EditingPost, type GoodTime } from '@/components/Composer';
import { requirePage } from '@/lib/auth';
import { assertPagesAllowed, targetScope } from '@/lib/page-access';
import { listLabels, listPageGroups } from '@/lib/page-groups';
import { screenMetadata } from '@/lib/metadata';
import { loadSelection } from '@/lib/page-filter';
import { prisma } from '@/lib/prisma';
import { parseMedia } from '@/lib/json';
import { localInputToUtc, utcToLocalInput } from '@/lib/time';
import { loadPagePosts } from '@/lib/page-analysis-data';
import { nextGoodTimes, suggestSlots } from '@/lib/queue-suggestions';
import { postIsEditable, canCompose, canManageOthersPosts, canPublishWithoutApproval } from '@/lib/constants';
import { aiAvailable } from '@/lib/ai';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('compose.title');
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The same ninety days of history as the Queue's suggestions. */
const LOOKBACK_DAYS = 90;
/** Nothing sooner than this: time to finish the post, and clear Facebook's floor. */
const EARLIEST_MINUTES = 30;

/**
 * When this week the workspace's Pages have done best, as ready-to-use
 * `datetime-local` values — the Queue's suggestions, brought to the moment
 * someone picks a time.
 */
async function loadGoodTimes(
  workspaceId: string,
  timeZone: string,
  scope: Parameters<typeof targetScope>[0],
): Promise<GoodTime[]> {
  const now = new Date();
  const pages = await prisma.target.findMany({
    where: { workspaceId, type: TargetType.page, ...targetScope(scope) },
    select: { id: true, name: true },
  });
  if (pages.length === 0) return [];

  const history = await Promise.all(
    pages.map(async (page) => ({
      pageName: page.name,
      posts: await loadPagePosts(page.id, new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS), now),
    })),
  );
  // Every good time counts here, including ones the queue already holds: this
  // is a time for one post, not a new weekly slot.
  const suggestions = suggestSlots({ pages: history, timeZone, existing: [] });

  const locale = await getLocale();
  const label = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });

  return nextGoodTimes({
    suggestions,
    timeZone,
    earliest: new Date(now.getTime() + EARLIEST_MINUTES * 60 * 1000),
    days: 7,
    toUtc: localInputToUtc,
  }).map(({ at, suggestion }) => ({
    value: utcToLocalInput(at, timeZone),
    label: label.format(at),
    lift: suggestion.lift,
    posts: suggestion.posts,
  }));
}


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
  // A viewer reads posts; the composer is not theirs.
  if (!canCompose(auth.role)) redirect('/calendar');
  const t = await getTranslations('compose');
  const params = await searchParams;
  const postId = Array.isArray(params.post) ? params.post[0] : params.post;

  const [targets, queueSlots, workspace, groups, labels] = await Promise.all([
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, ...targetScope(auth.pageScope) },
      include: { socialAccount: { select: { name: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.queueSlot.count({ where: { workspaceId: auth.workspace.id } }),
    prisma.workspace.findUniqueOrThrow({
      where: { id: auth.workspace.id },
      select: { aiEnabled: true },
    }),
    listPageGroups(auth.workspace.id, auth.pageScope),
    listLabels(auth.workspace.id),
  ]);

  const [editing, goodTimes, selection] = await Promise.all([
    postId ? loadForEditing(postId, auth) : null,
    loadGoodTimes(auth.workspace.id, auth.workspace.timezone, auth.pageScope),
    loadSelection(auth, params),
  ]);
  // A link to a post that is gone, belongs to another client, or has already
  // been published is a 404 rather than a blank composer — silently opening an
  // empty form would lose the edit without saying so.
  if (postId && !editing) notFound();

  // One hour out is a friendlier default than "now", and clears Facebook's
  // 10-minute floor for natively scheduled posts.
  const defaultScheduledAt =
    requestedTime(params.at, auth.workspace.timezone) ??
    utcToLocalInput(new Date(Date.now() + 60 * 60 * 1000), auth.workspace.timezone);

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
        goodTimes={goodTimes}
        groups={groups.filter((group) => group.targetIds.length > 0)}
        labels={labels}
        canEditLabels={canPublishWithoutApproval(auth.role)}
        aiEnabled={aiAvailable() && workspace.aiEnabled}
        requiresApproval={auth.workspace.requiresApproval}
        canPublishDirectly={canPublishWithoutApproval(auth.role)}
        {...(editing ? { editing } : {})}
        // `?to=` from a Page's card: start with that Page ticked. Otherwise the
        // profiles narrowed to elsewhere in the app; never every Page by default.
        initialTargetIds={
          editing
            ? undefined
            : (requestedTargets(params.to, targets) ??
              (selection.narrowed ? requestedTargets(selection.ids.join(','), targets) : undefined))
        }
        {...(editing ? {} : sharedIn(params))}
        targets={targets.map((target) => ({
          id: target.id,
          name: target.name,
          type: target.type,
          pictureUrl: target.pictureUrl,
          canPublish: target.canPublish && target.enabled,
          publishBlocker: target.enabled ? target.publishBlocker : t('targetPaused'),
          // A paused destination is explained here rather than by a code: the
          // pause is our own state, not something Facebook told us.
          publishBlockerCode: target.enabled ? target.publishBlockerCode : null,
          accountName: target.socialAccount?.name ?? null,
        }))}
      />
    </div>
  );
}

type Auth = Awaited<ReturnType<typeof requirePage>>;

/** The destinations named by `?to=`, kept only where they can be posted to. */
function requestedTargets(
  raw: string | string[] | undefined,
  targets: Array<{ id: string; canPublish: boolean; enabled: boolean }>,
): string[] | undefined {
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((value) => value.split(','));
  const usable = targets.filter((target) => ids.includes(target.id) && target.canPublish && target.enabled);
  return usable.length > 0 ? usable.map((target) => target.id) : undefined;
}

/**
 * `?at=YYYY-MM-DDTHH:mm`, from the calendar's "new post on this day", when it
 * names a time far enough ahead to schedule — otherwise the usual default. A
 * stale link to a day that has gone by opens the composer as normal rather
 * than on a time it would refuse.
 */
function requestedTime(raw: string | string[] | undefined, timeZone: string): string | null {
  const at = Array.isArray(raw) ? raw[0] : raw;
  if (!at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) return null;
  const instant = localInputToUtc(at, timeZone);
  if (Number.isNaN(instant.getTime())) return null;
  return instant.getTime() > Date.now() + EARLIEST_MINUTES * 60 * 1000 ? at : null;
}

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
  try {
    assertPagesAllowed(auth.pageScope, post.targets.map((target) => target.targetId));
  } catch {
    return null;
  }
  const labelRows = await prisma.postLabel.findMany({ where: { postId: post.id }, select: { labelId: true } });

  return {
    id: post.id,
    message: post.message,
    firstComment: post.firstComment,
    firstCommentDelayMinutes: post.firstCommentDelayMinutes,
    labelIds: labelRows.map((row) => row.labelId),
    format: (['post', 'reel', 'story'].includes(post.format) ? post.format : 'post') as 'post' | 'reel' | 'story',
    link: post.link,
    media: parseMedia(post.media),
    targetIds: post.targets.map((target) => target.targetId),
    // The workspace's zone, not the post's own. The composer sends back
    // whatever zone it was given, and it is given the workspace's — so
    // rendering the field in a different one meant that opening a post from
    // before a timezone change and pressing Save, without touching anything,
    // moved it by the difference between the two. Every other screen shows
    // workspace time as well, so this is also the number the person just saw
    // on the list they clicked from.
    scheduledAtLocal: post.scheduledAt
      ? utcToLocalInput(post.scheduledAt, auth.workspace.timezone)
      : null,
    publishMode: post.publishMode,
  };
}

/**
 * What the phone's share sheet (the installed app's share target) or the
 * bookmarklet hands over: `title`, `text` and `url`. The link goes in the link
 * field, so Facebook draws its card; the words go in the post.
 */
function sharedIn(params: Record<string, string | string[] | undefined>): { initialMessage?: string; initialLink?: string } {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 5000);
  const title = one(params.title);
  let text = one(params.text);
  let url = one(params.url);
  // Android puts the link inside `text` more often than in `url`.
  if (!url && text) {
    const found = /https?:\/\/\S+/.exec(text);
    if (found) {
      url = found[0];
      text = text.replace(found[0], '').trim();
    }
  }
  const valid = url && /^https?:\/\//.test(url) ? url : undefined;
  const message = [title && title !== text ? title : null, text].filter(Boolean).join('\n\n');
  return { ...(message ? { initialMessage: message } : {}), ...(valid ? { initialLink: valid } : {}) };
}
