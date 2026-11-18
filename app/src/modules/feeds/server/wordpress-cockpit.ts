import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { addDaysToKey, instantToWall, wallTimeToInstant } from '@/lib/calendar-dates';
import { prisma } from '@/server/data';
import { Prisma } from '../../../../generated/client';
import { postThumbnail, safeWebUrl } from '@/components/post-thumbnail';
import { autopilotOf, postScore, type AutopilotLogEntry, type AutopilotSettings } from '../wordpress/autopilot';
import { bestStyle } from '../wordpress/caption';
import { channelConfig } from '../wordpress/recipe';
import { authorizeFeeds, authorizeFeedWrite, type FeedActor } from './access';
import { configOf } from './wordpress-planner';
import { loadWordpressSettings, type WordpressSettings } from './wordpress-settings';
import { selectSource, stillFailedSql, type SourceRow } from './wordpress-store';

/**
 * Autopilot cockpit (2026-11-16, docs/autopilot-plan.md): every channel at a glance, tomorrow's plan to approve in one
 * tap, and the weekly report. Also sends the evening « plan ready » and the weekly report notifications.
 */
export type CockpitPost = { planId: string; targetId: string; targetName: string; slotAt: string; time: string; title: string; score: number | null; kind: string | null; postId: string | null; caption: string; image: string | null; flagged: boolean; state: string; reason: string | null;
  /** Where the post stands (2026-11-17): live, still to come, failed, or a time left empty; people reached once live. */
  status: 'published' | 'upcoming' | 'failed' | 'empty'; reach: number | null; url: string | null };
export type CockpitChannel = { id: string; name: string; paused: boolean; pausedReason: string | null; autoTimes: boolean; times: string[]; next: CockpitPost | null; reachToday: number; postsToday: number; failedWeek: number;
  /** The last seven days (2026-11-17): people reached per day, oldest first, the total and the seven days before. */
  daily: number[]; weekReach: number; previousReach: number; weekPosts: number;
  /** What this Page's memory has learned (2026-11-18); null before its first lesson. */
  learned: import('../wordpress/memory').Highlights | null };
export type WeeklyReport = {
  from: string; to: string; published: number; reach: number; previousReach: number;
  channels: Array<{ id: string; name: string; posts: number; reach: number; previousReach: number; daily: number[]; best: { title: string; reach: number } | null }>;
  best: { title: string; channel: string; reach: number } | null; bestHour: number | null;
  learned: AutopilotLogEntry[]; styles: Record<string, { posts: number; average: number }>; preferredStyle: string | null;
};
export type CockpitView = {
  enabled: boolean; sourceName: string; timeZone: string; pilot: AutopilotSettings; canWrite: boolean;
  channels: CockpitChannel[]; today: { date: string; posts: CockpitPost[] }; tomorrow: { date: string; posts: CockpitPost[]; approved: boolean; averageScore: number | null; flagged: number };
  report: WeeklyReport;
  /** The latest failures of the last seven days (2026-11-17), so « 1 failed » names which one. */
  failures: Array<{ planId: string; title: string; targetName: string; slotAt: string; reason: string | null; postId: string | null }>;
  ai: AiUse | null;
};
/** AI use this month (2026-11-16): requests and estimated tokens by use, cost when the model is priced, and the busiest hour against the hourly limit. */
export type AiUse = { requests: number; inputTokens: number; outputTokens: number; costUsd: number | null; unpriced: number; byKind: Array<{ kind: string; requests: number; inputTokens: number; outputTokens: number }>; peakHour: number; hourlyLimit: number | null; model: string | null };

const reachOf = (insights: unknown): number => {
  if (!insights || typeof insights !== 'object') return 0;
  const i = insights as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n(i.post_total_media_view_unique) || n(i.reach) || n(i.post_media_view);
};
const thumb = (media: unknown): string | null => postThumbnail(media)?.url ?? null;

/** The source a member may read, its settings and channels. */
async function context(actor: FeedActor, write = false) {
  const auth = write ? await authorizeFeedWrite(actor) : await authorizeFeeds(actor, 'read');
  const settings = await loadWordpressSettings();
  const source = await selectSource(actor.workspaceId);
  if (!source) throw new OperationError('not_found', 'Set up the recipe source first.');
  const allowed = auth.actor.allowedTargetIds;
  const pages = (await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM targets WHERE "workspaceId" = ${actor.workspaceId} AND enabled = true AND "canPublish" = true AND type::text = ANY(${settings.targetTypes}::text[]) ORDER BY name ASC, id ASC LIMIT ${settings.maxTargets}`)
    .filter(page => (source.allTargets || source.targetIds.includes(page.id)) && (allowed === undefined || allowed.includes(page.id)));
  return { auth, settings, source, pages, config: configOf(settings, source) };
}

type PlanRow = { wpPostIdForRating?: string; id: string; targetId: string; slotAt: Date; scheduledAt: Date | null; title: string; score: number | null; kind: string | null; postId: string | null; state: string; reason: string | null; message: string | null; media: unknown; targetStatus: string | null; remoteUrl: string | null; insights: unknown };
async function plansBetween(sourceId: string, from: Date, to: Date): Promise<PlanRow[]> {
  return prisma.$queryRaw<PlanRow[]>`SELECT l.id, l."targetId", l."wpPostId" AS "wpPostIdForRating", l."slotAt", p."scheduledAt", l.title, l.score, l.kind, l."postId", l.state, l.reason, p.message, p.media, pt.status::text AS "targetStatus", pt."remoteUrl", ep.insights FROM wordpress_recipe_plans l
    LEFT JOIN posts p ON p.id = l."postId" AND p."workspaceId" = l."workspaceId"
    LEFT JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId"
    LEFT JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
    WHERE l."sourceId" = ${sourceId} AND l."slotAt" >= ${from} AND l."slotAt" < ${to} ORDER BY l."slotAt" ASC, l."targetId" ASC`;
}

export async function readCockpit(actor: FeedActor, now = new Date()): Promise<CockpitView> {
  const { auth, source, pages, config } = await context(actor);
  const pilot = autopilotOf(config.autopilot);
  const tz = config.timezone;
  const today = instantToWall(now, tz).date;
  const tomorrow = addDaysToKey(today, 1);
  const dayStart = (date: string) => { const at = wallTimeToInstant(date, '00:00', tz); return at.ok ? at.instant : new Date(`${date}T00:00:00Z`); };
  const names = new Map(pages.map(page => [page.id, page.name]));
  const view = (row: PlanRow): CockpitPost => ({
    planId: row.id, targetId: row.targetId, targetName: names.get(row.targetId) ?? '', slotAt: (row.scheduledAt ?? row.slotAt).toISOString(), time: instantToWall(row.scheduledAt ?? row.slotAt, tz).time,
    title: row.title, score: row.score, kind: row.kind, postId: row.postId, caption: (row.message ?? '').slice(0, 280), image: thumb(row.media),
    flagged: row.state === 'planned' && typeof row.score === 'number' && row.score < 45, state: row.state, reason: row.reason,
    status: row.reason === 'left_empty' ? 'empty' : row.state !== 'planned' || row.targetStatus === 'failed' || row.targetStatus === 'cancelled' ? 'failed' : row.targetStatus === 'published' ? 'published' : 'upcoming',
    reach: row.targetStatus === 'published' ? reachOf(row.insights) : null, url: row.targetStatus === 'published' ? safeWebUrl(row.remoteUrl) : null,
  });
  const [upcoming, board, todayPlans] = await Promise.all([plansBetween(source.id, now, new Date(now.getTime() + 3 * 86_400_000)), plansBetween(source.id, dayStart(tomorrow), dayStart(addDaysToKey(tomorrow, 1))), plansBetween(source.id, dayStart(today), dayStart(tomorrow))]);
  const ids = pages.map(page => page.id);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const gap = pilot.bestTimes.gapMinutes;
  const [todayRows, failed, failures] = await Promise.all([
    ids.length ? prisma.$queryRaw<Array<{ targetId: string; insights: unknown }>>`SELECT "targetId", insights FROM external_posts WHERE "targetId" = ANY(${ids}::text[]) AND "createdTime" >= ${dayStart(today)}` : [],
    prisma.$queryRaw<Array<{ targetId: string; count: bigint }>>(Prisma.sql`SELECT l."targetId", COUNT(*)::bigint AS count FROM wordpress_recipe_plans l WHERE l."sourceId" = ${source.id} AND l.state IN ('failed', 'uncertain') AND ${stillFailedSql('l', gap)} AND l."slotAt" >= ${weekAgo} GROUP BY l."targetId"`),
    ids.length ? prisma.$queryRaw<Array<{ id: string; targetId: string; slotAt: Date; title: string; reason: string | null; postId: string | null }>>(Prisma.sql`SELECT l.id, l."targetId", l."slotAt", l.title, l.reason, l."postId" FROM wordpress_recipe_plans l
      WHERE l."sourceId" = ${source.id} AND l."targetId" = ANY(${ids}::text[]) AND l.state IN ('failed', 'uncertain') AND ${stillFailedSql('l', gap)} AND l."slotAt" >= ${weekAgo} AND l."slotAt" < ${now}
      ORDER BY l."slotAt" DESC LIMIT 3`) : [],
  ]);
  const report = await weeklyReport(source, pages, pilot, tz, now);
  const memories = await import('./wordpress-memory').then(m => m.readPageMemories(source.id)).catch(() => new Map());
  const { memoryModel } = await import('../wordpress/memory');
  const model = memoryModel(memories);
  const channels: CockpitChannel[] = pages.map(page => {
    const week = report.channels.find(row => row.id === page.id);
    const own = config.channels?.[page.id];
    const next = upcoming.find(row => row.targetId === page.id && row.state === 'planned');
    const mine = todayRows.filter(row => row.targetId === page.id);
    return { id: page.id, name: page.name, paused: own?.paused === true, pausedReason: own?.pausedReason ?? null, autoTimes: own?.autoTimes === true || (!own?.slots?.length && Boolean(pilot.learnedTimes?.[page.id])), times: channelConfig(config, page.id).slots,
      next: next ? view(next) : null, reachToday: mine.reduce((sum, row) => sum + reachOf(row.insights), 0), postsToday: mine.length, failedWeek: Number(failed.find(row => row.targetId === page.id)?.count ?? 0),
      daily: week?.daily ?? [], weekReach: week?.reach ?? 0, previousReach: week?.previousReach ?? 0, weekPosts: week?.posts ?? 0,
      learned: memories.has(page.id) ? model.highlights(page.id) : null };
  });
  const byTime = (a: CockpitPost, b: CockpitPost) => a.slotAt.localeCompare(b.slotAt) || a.targetName.localeCompare(b.targetName);
  // Today keeps what failed too: the day's page says what happened, not only what is planned.
  const todayPosts = todayPlans.filter(row => names.has(row.targetId) && row.reason !== 'replaced' && row.state !== 'claimed').map(view).sort(byTime);
  const boardPosts = board.filter(row => names.has(row.targetId) && (row.state === 'planned' || row.reason === 'left_empty')).map(view).sort(byTime);
  const scores = boardPosts.flatMap(post => typeof post.score === 'number' && post.state === 'planned' ? [post.score] : []);
  return {
    enabled: source.enabled, sourceName: source.name, timeZone: tz, pilot, canWrite: auth.role === 'owner' || auth.role === 'admin' || auth.role === 'editor',
    channels, today: { date: today, posts: todayPosts }, tomorrow: { date: tomorrow, posts: boardPosts, approved: (pilot.approvedDays ?? []).includes(tomorrow), averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, flagged: boardPosts.filter(post => post.flagged).length },
    report,
    failures: failures.map(row => ({ planId: row.id, title: row.title, targetName: names.get(row.targetId) ?? '', slotAt: row.slotAt.toISOString(), reason: row.reason, postId: row.postId })),
    ai: await aiUse(actor.workspaceId, now).catch(() => null),
  };
}

/** The last seven days against the seven before: posts, people reached, best recipes and hours, what was learned. */
export async function weeklyReport(source: SourceRow, pages: ReadonlyArray<{ id: string; name: string }>, pilot: AutopilotSettings, tz: string, now: Date): Promise<WeeklyReport> {
  const from = new Date(now.getTime() - 7 * 86_400_000); const before = new Date(now.getTime() - 14 * 86_400_000);
  const rows = await prisma.$queryRaw<Array<{ targetId: string; title: string | null; slotAt: Date; publishedAt: Date | null; insights: unknown; style: string | null }>>`SELECT l."targetId", l.title, l."slotAt", pt."publishedAt", ep.insights, l.style
    FROM wordpress_recipe_plans l JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published'
    LEFT JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
    WHERE l."sourceId" = ${source.id} AND l.state = 'planned' AND l."slotAt" >= ${before} AND l."slotAt" < ${now}`;
  const names = new Map(pages.map(page => [page.id, page.name]));
  const week = rows.filter(row => row.slotAt >= from && names.has(row.targetId));
  const previous = rows.filter(row => row.slotAt < from && names.has(row.targetId));
  const total = (list: typeof rows) => list.reduce((sum, row) => sum + reachOf(row.insights), 0);
  const channels = pages.map(page => {
    const mine = week.filter(row => row.targetId === page.id);
    const top = [...mine].sort((a, b) => reachOf(b.insights) - reachOf(a.insights))[0];
    const daily = Array.from({ length: 7 }, (_, index) => total(mine.filter(row => Math.min(6, Math.floor((row.slotAt.getTime() - from.getTime()) / 86_400_000)) === index)));
    return { id: page.id, name: page.name, posts: mine.length, reach: total(mine), previousReach: total(previous.filter(row => row.targetId === page.id)), daily, best: top && reachOf(top.insights) ? { title: top.title ?? '', reach: reachOf(top.insights) } : null };
  });
  const top = [...week].sort((a, b) => reachOf(b.insights) - reachOf(a.insights))[0];
  const byHour = new Map<number, number[]>();
  for (const row of week) { const at = row.publishedAt ?? row.slotAt; const hour = Number(instantToWall(at, tz).time.slice(0, 2)); byHour.set(hour, [...(byHour.get(hour) ?? []), reachOf(row.insights)]); }
  const bestHour = [...byHour].filter(([, values]) => values.length >= 3).sort((a, b) => b[1].reduce((x, y) => x + y, 0) / b[1].length - a[1].reduce((x, y) => x + y, 0) / a[1].length)[0]?.[0] ?? null;
  // Relative results per style, against each channel's median, for the hook test summary.
  const medians = new Map<string, number>();
  for (const page of pages) { const v = week.filter(row => row.targetId === page.id).map(row => postScore(row.insights) ?? 0).sort((a, b) => a - b); if (v.length) medians.set(page.id, v[Math.floor(v.length / 2)]! || 1); }
  const styled = bestStyle(week.map(row => ({ style: row.style, relative: (postScore(row.insights) ?? 0) / (medians.get(row.targetId) || 1) })), 3);
  return {
    from: from.toISOString(), to: now.toISOString(), published: week.length, reach: total(week), previousReach: total(previous), channels,
    best: top && reachOf(top.insights) ? { title: top.title ?? '', channel: names.get(top.targetId) ?? '', reach: reachOf(top.insights) } : null, bestHour,
    learned: (pilot.log ?? []).filter(entry => Date.parse(entry.at) >= from.getTime()).slice(0, 20), styles: styled.stats, preferredStyle: styled.style,
  };
}

const approveSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), confirmation: z.string().max(100) }).strict();
export const approveDayConfirmation = (date: string) => `APPROVE AUTOPILOT PLAN ${date}`;

/** Approve a day's plan on the board: recorded on the source and in the audit log; the posts go out as planned. */
export async function approveAutopilotDay(actor: FeedActor, input: unknown): Promise<{ date: string; approved: true }> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== approveDayConfirmation(parsed.data.date)) throw new OperationError('invalid_request', 'Confirm the exact plan to approve.');
  const { source } = await context(actor, true);
  const raw = (source.config && typeof source.config === 'object' ? { ...(source.config as Record<string, unknown>) } : {});
  const pilot = (raw.autopilot && typeof raw.autopilot === 'object' ? { ...(raw.autopilot as Record<string, unknown>) } : {});
  const days = Array.isArray(pilot.approvedDays) ? pilot.approvedDays.filter((day): day is string => typeof day === 'string') : [];
  pilot.approvedDays = [parsed.data.date, ...days.filter(day => day !== parsed.data.date)].slice(0, 60);
  raw.autopilot = pilot;
  await prisma.$executeRaw`UPDATE wordpress_recipe_sources SET config = ${JSON.stringify(raw)}::jsonb, "updatedAt" = NOW() WHERE id = ${source.id} AND "workspaceId" = ${actor.workspaceId}`;
  const { audit } = await import('./core');
  await audit(prisma as unknown as Parameters<typeof audit>[0], actor.workspaceId, actor, 'feeds.autopilot_plan_approved', { sourceId: source.id, date: parsed.data.date }).catch(() => undefined);
  return { date: parsed.data.date, approved: true };
}

/**
 * Evening « plan ready » (at the review hour, for tomorrow) and the weekly report (on the chosen day, from 08:00), to
 * owners and admins. Each is sent once: the notification's event id names the source and the day.
 */
export async function notifyAutopilot(settings: WordpressSettings, source: SourceRow, now: Date): Promise<string[]> {
  const config = configOf(settings, source);
  const pilot = autopilotOf(config.autopilot);
  const wall = instantToWall(now, config.timezone);
  const hour = Number(wall.time.slice(0, 2));
  const sends: Array<{ kind: 'autopilot_board' | 'autopilot_report'; eventId: string }> = [];
  if (pilot.review.enabled && pilot.review.notify && hour >= pilot.review.hour) {
    const tomorrow = addDaysToKey(wall.date, 1);
    const start = wallTimeToInstant(tomorrow, '00:00', config.timezone); const end = wallTimeToInstant(addDaysToKey(tomorrow, 1), '00:00', config.timezone);
    if (start.ok && end.ok && (await plansBetween(source.id, start.instant, end.instant)).some(row => row.state === 'planned')) sends.push({ kind: 'autopilot_board', eventId: `autopilot_board_${source.id}_${tomorrow}` });
  }
  const weekday = new Date(`${wall.date}T12:00:00Z`).getUTCDay();
  const day = { sun: 0, mon: 1, fri: 5 }[pilot.digest.day];
  if (pilot.digest.enabled && weekday === day && hour >= 8) sends.push({ kind: 'autopilot_report', eventId: `autopilot_report_${source.id}_${wall.date}` });
  if (!sends.length) return [];
  const members = await prisma.$queryRaw<Array<{ userId: string }>>`SELECT m."userId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${source.workspaceId} AND m.role::text IN ('owner', 'admin') AND u."disabledAt" IS NULL`;
  const { enqueueNotification } = await import('@/modules/settings/notifications/server');
  const sent: string[] = [];
  for (const send of sends) for (const member of members) {
    const result = await prisma.$transaction(tx => enqueueNotification(tx, { eventId: send.eventId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200), workspaceId: source.workspaceId, userId: member.userId, kind: send.kind })).catch(() => ({ inserted: false }));
    if (result.inserted) sent.push(send.kind);
  }
  return sent;
}

export async function aiUse(workspaceId: string, now: Date): Promise<AiUse> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [kinds, peak, model] = await Promise.all([
    prisma.$queryRaw<Array<{ kind: string | null; requests: bigint; input: bigint | null; output: bigint | null; cost: number | null; unpriced: bigint }>>`SELECT detail->>'kind' AS kind, COUNT(*)::bigint AS requests,
      SUM((detail->>'inputTokens')::bigint)::bigint AS input, SUM((detail->>'outputTokens')::bigint)::bigint AS output,
      SUM((detail->>'costUsd')::numeric)::float8 AS cost, COUNT(*) FILTER (WHERE detail->>'costUsd' IS NULL)::bigint AS unpriced
      FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'ai.completed' AND "createdAt" >= ${start} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'ai.requested' AND "createdAt" >= ${start} GROUP BY date_trunc('hour', "createdAt") ORDER BY 1 DESC LIMIT 1`,
    prisma.$queryRaw<Array<{ model: string | null }>>`SELECT detail->>'model' AS model FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'ai.completed' ORDER BY "createdAt" DESC LIMIT 1`,
  ]);
  const { runtimeConfig } = await import('@/server/config/store');
  const limit = Number(await runtimeConfig('ai.hourlyRequestsPerWorkspace').catch(() => NaN));
  const n = (v: bigint | number | null) => Number(v ?? 0);
  const priced = kinds.some(k => k.cost !== null && n(k.requests) > n(k.unpriced));
  return {
    requests: kinds.reduce((s, k) => s + n(k.requests), 0), inputTokens: kinds.reduce((s, k) => s + n(k.input), 0), outputTokens: kinds.reduce((s, k) => s + n(k.output), 0),
    costUsd: priced ? Math.round(kinds.reduce((s, k) => s + (k.cost ?? 0), 0) * 100) / 100 : null, unpriced: kinds.reduce((s, k) => s + n(k.unpriced), 0),
    byKind: kinds.map(k => ({ kind: k.kind ?? 'other', requests: n(k.requests), inputTokens: n(k.input), outputTokens: n(k.output) })),
    peakHour: n(peak[0]?.count ?? 0), hourlyLimit: Number.isFinite(limit) && limit > 0 ? limit : null, model: model[0]?.model ?? null,
  };
}

export const REFRESH_PLAN_CONFIRMATION = 'REPLAN WITH PAGE MEMORY';
/** Below this expected value (1 = the Page's usual), a planned recipe is replaced. */
const REPLACE_BELOW = 1;

/**
 * Re-plan with each Page's memory (2026-11-18, owner: « plan viral content starting from tomorrow »): the recipes
 * planned for tomorrow and the day after, still scheduled and more than three hours away, that their Page's memory
 * expects to do below that Page's usual are replaced through the usual « another recipe » path, which now chooses
 * with the memory. Recipes the memory knows nothing about are left as they are. Logged in the audit log.
 */
export async function refreshPlanWithMemory(actor: FeedActor, input: unknown, now = new Date()): Promise<{ examined: number; replaced: number; kept: number; failed: number; unknown: number }> {
  const parsed = z.object({ confirmation: z.literal(REFRESH_PLAN_CONFIRMATION) }).strict().safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Confirm the re-planning.');
  const { source, pages, config } = await context(actor, true);
  const { readPageMemories } = await import('./wordpress-memory');
  const memories = await readPageMemories(source.id);
  if (!memories.size) throw new OperationError('conflict', 'The Pages have not learned anything yet. Try again after the next planning run.');
  const { memoryModel } = await import('../wordpress/memory');
  const model = memoryModel(memories);
  const tz = config.timezone;
  const tomorrow = addDaysToKey(instantToWall(now, tz).date, 1);
  const start = wallTimeToInstant(tomorrow, '00:00', tz); const end = wallTimeToInstant(addDaysToKey(tomorrow, 2), '00:00', tz);
  if (!start.ok || !end.ok) throw new OperationError('unavailable', 'The plan could not be read.');
  const names = new Set(pages.map(page => page.id));
  const rows = (await plansBetween(source.id, start.instant, end.instant)).filter(row => names.has(row.targetId) && row.state === 'planned' && row.postId && row.targetStatus !== 'published'
    && (row.scheduledAt ?? row.slotAt).getTime() > now.getTime() + 3 * 3_600_000);
  const { prismaScoringPorts } = await import('./wordpress-scoring');
  const ratings = await prismaScoringPorts.ratings(source.id, rows.map(row => row.wpPostIdForRating ?? '')).catch(() => new Map());
  const { changeRecipeSlotNow } = await import('./wordpress');
  const { replaceRecipeSlotConfirmation } = await import('../wordpress/recipe');
  const out = { examined: rows.length, replaced: 0, kept: 0, failed: 0, unknown: 0 };
  const entries: import('../wordpress/autopilot').AutopilotLogEntry[] = [];
  const pageName = new Map(pages.map(page => [page.id, page.name]));
  for (const row of rows) {
    const rating = ratings.get(row.wpPostIdForRating ?? '');
    const value = model.contentValue(row.targetId, row.title, row.kind, row.slotAt, tz, rating ? { traits: rating.traits ?? null, appeal: rating.photo } : null);
    if (value === null) { out.unknown++; continue; }
    if (value >= REPLACE_BELOW) { out.kept++; continue; }
    try {
      await changeRecipeSlotNow(actor, { planId: row.id, confirmation: replaceRecipeSlotConfirmation(row.id), action: 'replace' });
      const after = (await plansBetween(source.id, row.slotAt, new Date(row.slotAt.getTime() + 1))).find(other => other.targetId === row.targetId && other.state === 'planned');
      out.replaced++;
      entries.push({ at: new Date().toISOString(), kind: 'healing', channelId: row.targetId, channelName: pageName.get(row.targetId)?.slice(0, 200), code: 'replanned', text: `« ${row.title.slice(0, 100)} » replaced by « ${(after?.title ?? '').slice(0, 100)} ».`,
        params: { from: row.title.slice(0, 120), to: (after?.title ?? '').slice(0, 120), fromValue: Math.round(value * 10) / 10, time: instantToWall(row.scheduledAt ?? row.slotAt, tz).time } });
    } catch { out.failed++; }
  }
  if (entries.length) {
    const { loadWordpressSettings } = await import('./wordpress-settings');
    const { logAutopilot } = await import('./wordpress-autopilot');
    const fresh = await selectSource(actor.workspaceId);
    if (fresh) await logAutopilot(await loadWordpressSettings(), fresh, entries).catch(() => undefined);
  }
  const { audit } = await import('./core');
  await audit(prisma as unknown as Parameters<typeof audit>[0], actor.workspaceId, actor, 'feeds.autopilot_replanned', { sourceId: source.id, ...out }).catch(() => undefined);
  return out;
}

/** From this local hour, once a day, the coming plan is checked again with the Page memories. */
export const DAILY_REPLAN_HOUR = 17;
/**
 * The daily re-check (2026-11-18): from DAILY_REPLAN_HOUR, once per local day (the audit log tells whether it ran
 * today), the same re-planning a member can ask for.
 */
export async function dailyReplan(actor: FeedActor, timeZone: string, now = new Date()): Promise<boolean> {
  const wall = instantToWall(now, timeZone);
  if (Number(wall.time.slice(0, 2)) < DAILY_REPLAN_HOUR) return false;
  const start = wallTimeToInstant(wall.date, '00:00', timeZone);
  if (!start.ok) return false;
  const done = await prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action = 'feeds.autopilot_replanned' AND "createdAt" >= ${start.instant}`;
  if (Number(done[0]?.count ?? 0) > 0) return false;
  await refreshPlanWithMemory(actor, { confirmation: REFRESH_PLAN_CONFIRMATION }, now);
  return true;
}

export const READ_PHOTOS_CONFIRMATION = 'READ PHOTOS NOW';
/** Read a batch of published photos now and say exactly what happened (2026-11-18): the AI usage and any problem. */
export async function readPhotosNow(actor: FeedActor, input: unknown, now = new Date()): Promise<{ queued: number; read: number; problem: string | null }> {
  const parsed = z.object({ confirmation: z.literal(READ_PHOTOS_CONFIRMATION) }).strict().safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Confirm reading the photos.');
  const { source } = await context(actor, true);
  const { photosToLearn } = await import('./wordpress-memory');
  const scoring = await import('./wordpress-scoring');
  const queue = await photosToLearn(source.id, now, scoring.PHOTO_BATCH);
  const read = queue.length ? Number(await scoring.prismaScoringPorts.ratePhotos({ userId: actor.userId, workspaceId: actor.workspaceId }, source, queue)) || 0 : 0;
  return { queued: queue.length, read, problem: (await import('./wordpress-scoring')).lastPhotoProblem };
}
