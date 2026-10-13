import type { Locale, Prisma, WorkspaceRole } from '@prisma/client';

import { translate } from './email/templates';

import { parseInsights, type PostInsights } from './json';
import { createPost, type CreatePostResult } from './posts';
import { prisma } from './prisma';
import { shiftLocalInput } from './spam-guard';
import { utcToLocalInput } from './time';
import type { CreatePostInput } from './validation';

/**
 * Caption A/B tests.
 *
 * The same content goes out with two to four captions. With at least as many
 * Pages as captions, the Pages are shared out between the captions and every
 * caption goes out at the same time; with fewer Pages, every Page gets every
 * caption, one a day at the same hour. After `hours` the worker compares
 * engagement per view and names a winner only when every caption had enough
 * views; otherwise it says so.
 */

export const LABELS = ['A', 'B', 'C', 'D'] as const;
const DAY_MINUTES = 24 * 60;
/** How long past the due time to wait for fresh insights before giving up. */
const INSIGHTS_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export interface CaptionResult {
  label: string;
  views: number;
  engagements: number;
  /** Engagements per view, 0–1; null without views. */
  rate: number | null;
}

/** Which captions go to which Pages, and how many days after the first each goes out. */
export function planCaptions(targetIds: string[], captions: number): Array<{ targetIds: string[]; dayOffset: number }> {
  if (targetIds.length >= captions) {
    return Array.from({ length: captions }, (_, index) => ({
      targetIds: targetIds.filter((_, position) => position % captions === index),
      dayOffset: 0,
    }));
  }
  return Array.from({ length: captions }, (_, index) => ({ targetIds, dayOffset: index }));
}

export async function createCaptionTest(
  context: { workspaceId: string; userId: string; role: WorkspaceRole; requiresApproval: boolean },
  input: CreatePostInput,
  now: Date = new Date(),
): Promise<CreatePostResult & { posts: number; captionTestId: string }> {
  const captions = [input.message, ...(input.captionVariants ?? [])];
  const plan = planCaptions(input.targetIds, captions.length);
  const start = input.scheduledAtLocal ?? utcToLocalInput(now, input.timezone);

  const test = await prisma.captionTest.create({
    data: {
      workspaceId: context.workspaceId,
      name: input.message.trim().split('\n')[0]!.slice(0, 80),
      hours: input.testHours ?? 48,
      createdById: context.userId,
    },
  });

  const created: CreatePostResult[] = [];
  for (const [index, part] of plan.entries()) {
    const later = part.dayOffset > 0;
    const result = await createPost(
      context,
      {
        ...input,
        message: captions[index]!,
        targetIds: part.targetIds,
        captionVariants: undefined,
        staggerMinutes: undefined,
        // A caption due on a later day waits for the worker, whatever the first did.
        publishMode: later && input.publishMode === 'immediate' ? 'worker' : input.publishMode,
        scheduledAtLocal: later ? shiftLocalInput(start, part.dayOffset * DAY_MINUTES) : input.scheduledAtLocal,
      },
      now,
    );
    await prisma.post.update({ where: { id: result.postId }, data: { captionTestId: test.id, captionLabel: LABELS[index] } });
    created.push(result);
  }

  return {
    ...created[0]!,
    results: created.flatMap((result) => result.results),
    posts: created.length,
    captionTestId: test.id,
  };
}

/** Engagements counted for a test: what someone did with the post. */
function engagementsOf(insights: PostInsights | null): number {
  if (!insights) return 0;
  return (insights.reactions ?? 0) + (insights.comments ?? 0) + (insights.shares ?? 0) + (insights.clicks ?? 0);
}

/** The figures per caption, summed over its Pages. */
export function tally(
  posts: Array<{ captionLabel: string | null; targets: Array<{ insights: Prisma.JsonValue | null }> }>,
): CaptionResult[] {
  const byLabel = new Map<string, CaptionResult>();
  for (const post of posts) {
    const label = post.captionLabel ?? '?';
    const entry = byLabel.get(label) ?? { label, views: 0, engagements: 0, rate: null };
    for (const target of post.targets) {
      const insights = target.insights ? parseInsights(target.insights) : null;
      entry.views += insights?.impressions ?? 0;
      entry.engagements += engagementsOf(insights);
    }
    byLabel.set(label, entry);
  }
  return [...byLabel.values()]
    .map((entry) => ({ ...entry, rate: entry.views > 0 ? entry.engagements / entry.views : null }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The verdict on finished figures: a winner only when every caption had enough views. */
export function decide(results: CaptionResult[], minViews: number): {
  status: 'decided' | 'inconclusive';
  reason: string | null;
  winnerLabel: string | null;
  lift: number | null;
} {
  if (results.length < 2 || results.some((result) => result.views < minViews)) {
    return { status: 'inconclusive', reason: 'not_enough_views', winnerLabel: null, lift: null };
  }
  const ranked = [...results].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const [best, next] = ranked as [CaptionResult, CaptionResult];
  if ((best.rate ?? 0) === (next.rate ?? 0)) {
    return { status: 'inconclusive', reason: 'tie', winnerLabel: null, lift: null };
  }
  const lift = next.rate ? ((best.rate! - next.rate) / next.rate) * 100 : null;
  return { status: 'decided', reason: null, winnerLabel: best.label, lift };
}

/** Read every test that is due. Database only: the insights come from the analytics sync. */
export async function evaluateCaptionTests(now: Date = new Date()): Promise<number> {
  const tests = await prisma.captionTest.findMany({
    where: { status: 'running' },
    include: {
      posts: {
        select: {
          captionLabel: true,
          status: true,
          targets: { select: { status: true, publishedAt: true, insights: true, insightsSyncedAt: true } },
        },
      },
    },
  });

  let finished = 0;
  for (const test of tests) {
    const targets = test.posts.flatMap((post) => post.targets);
    const labels = new Set(test.posts.map((post) => post.captionLabel));
    let outcome: { status: string; reason: string | null; winnerLabel?: string | null; lift?: number | null; results?: CaptionResult[] } | null = null;

    const broken =
      labels.size < 2 ||
      test.posts.some((post) => ['failed', 'cancelled', 'rejected'].includes(post.status)) ||
      targets.some((target) => ['failed', 'cancelled', 'skipped'].includes(target.status));
    if (broken) {
      outcome = { status: 'inconclusive', reason: 'not_published' };
    } else if (targets.length > 0 && targets.every((target) => target.status === 'published' && target.publishedAt)) {
      const last = Math.max(...targets.map((target) => target.publishedAt!.getTime()));
      const due = last + test.hours * 60 * 60 * 1000;
      if (now.getTime() >= due) {
        const fresh = targets.every((target) => target.insightsSyncedAt && target.insightsSyncedAt.getTime() >= due);
        if (fresh) {
          const results = tally(test.posts);
          outcome = { ...decide(results, test.minViews), results };
        } else if (now.getTime() > due + INSIGHTS_GRACE_MS) {
          outcome = { status: 'inconclusive', reason: 'no_insights', results: tally(test.posts) };
        }
      }
    }
    if (!outcome) continue;

    // Claimed by its status, so two workers record one verdict.
    const claimed = await prisma.captionTest.updateMany({
      where: { id: test.id, status: 'running' },
      data: {
        status: outcome.status,
        reason: outcome.reason,
        winnerLabel: outcome.winnerLabel ?? null,
        lift: outcome.lift ?? null,
        results: (outcome.results ?? undefined) as Prisma.InputJsonValue | undefined,
        decidedAt: now,
      },
    });
    finished += claimed.count;
  }
  return finished;
}

/**
 * The winning caption, as a line for the Pages' voice, so the AI writes more
 * like what worked. Added once; the Page voice stays editable as before.
 */
export function learningLine(locale: Locale, winner: string, loser: string, lift: number | null): string {
  const clip = (text: string) => (text.length > 140 ? `${text.slice(0, 139)}…` : text).replace(/\s+/g, ' ');
  return translate(locale, lift !== null ? 'captionTests.learningLift' : 'captionTests.learning', {
    winner: clip(winner),
    loser: clip(loser),
    lift: Math.round(lift ?? 0),
  });
}

/** The longest Page voice the profile form accepts. */
const VOICE_LIMIT = 2000;

export async function saveLearning(options: { id: string; workspaceId: string }): Promise<'ok' | 'not_found' | 'not_decided' | 'already'> {
  const test = await prisma.captionTest.findFirst({
    where: { id: options.id, workspaceId: options.workspaceId },
    include: { posts: { select: { message: true, captionLabel: true, targets: { select: { targetId: true } } } } },
  });
  if (!test) return 'not_found';
  if (test.status !== 'decided' || !test.winnerLabel) return 'not_decided';
  if (test.learnedAt) return 'already';

  const winner = test.posts.find((post) => post.captionLabel === test.winnerLabel);
  const results = (test.results as CaptionResult[] | null) ?? [];
  const runnerUp = [...results].filter((result) => result.label !== test.winnerLabel).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
  const loser = test.posts.find((post) => post.captionLabel === runnerUp?.label);
  if (!winner || !loser) return 'not_decided';

  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: options.workspaceId }, select: { defaultLocale: true } });
  const line = learningLine(workspace.defaultLocale, winner.message.trim(), loser.message.trim(), test.lift);
  const targetIds = [...new Set(test.posts.flatMap((post) => post.targets.map((target) => target.targetId)))];
  const pages = await prisma.target.findMany({ where: { id: { in: targetIds }, workspaceId: options.workspaceId }, select: { id: true, brandVoice: true } });

  await prisma.$transaction([
    // A voice already near the form's limit is left as it is rather than cut.
    ...pages.flatMap((page) => {
      const voice = [page.brandVoice?.trim(), line].filter(Boolean).join('\n');
      return voice.length <= VOICE_LIMIT ? [prisma.target.update({ where: { id: page.id }, data: { brandVoice: voice } })] : [];
    }),
    prisma.captionTest.update({ where: { id: test.id }, data: { learnedAt: new Date() } }),
  ]);
  return 'ok';
}
