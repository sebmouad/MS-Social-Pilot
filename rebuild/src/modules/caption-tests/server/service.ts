import { createPublishingDraftBatch } from '@/modules/publishing/server/lifecycle';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { configOrDefault } from '@/server/config/config-or-default';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { platformAnalytics } from '@/server/platforms/registry';
import type { PostPerformance, PostPerformanceRequest } from '@/server/platforms/host';
import { authorizeAi, type AiActor } from '@/modules/ai/server/access';
import { WORKSPACE_OPERATION_BOUNDS } from '@/modules/settings/workspace-operations';
import type { Prisma } from '../../../../generated/client';
import { captionTestsCopySchema, captionTestsPolicySchema } from '../config';
import type { CaptionTestsCopy } from '../copy';
import { decide, firstMeasure, LABELS, learningLine, sumMeasures, tally, type CaptionResult, type PostFigures, type Verdict } from '../pure';

export type Locale = 'en' | 'fr';
export type CaptionActor = AiActor & { apiKeyId?: string };
export type PerformanceReader = (provider: string, request: PostPerformanceRequest) => Promise<PostPerformance[] | null>;
export type CaptionDeps = { locale?: Locale; now?: () => Date; performance?: PerformanceReader };
type Tx = Prisma.TransactionClient;
type Policy = z.infer<typeof captionTestsPolicySchema>;

/** Read access to results is Analytics posts; starting a test is composing posts; learning edits workspace settings. */
export const LIST_FEATURE = 'analytics/posts';
export const START_FEATURE = 'publishing/posts';
export const LEARN_FEATURE = 'settings/workspace';
export const START_CONFIRMATION = 'START CAPTION TEST';
export const learnConfirmation = (id: string) => `LEARN ${id}`;
const STARTABLE = ['draft', 'pending_approval', 'scheduled', 'publishing', 'published'];

export const startSchema = (p: Policy) => z.object({
  name: z.string().trim().max(p.nameMaxCharacters).optional(), hours: z.number().int().min(p.minHours).max(p.maxHours).optional(),
  minViews: z.number().int().min(1).max(p.maxMinViews).optional(), postIds: z.array(z.string().min(1).max(200)).min(p.minCaptions).max(p.maxCaptions),
  confirmation: z.string(),
}).strict();
export const learnSchema = z.object({ id: z.string().min(1).max(200), confirmation: z.string() }).strict();

async function policyOf(): Promise<Policy> {
  const parsed = captionTestsPolicySchema.safeParse(await runtimeConfig('captionTests.policy'));
  if (!parsed.success || !parsed.data.enabled) throw new OperationError('unavailable', 'unavailable');
  return parsed.data;
}
async function copyOf(locale: Locale): Promise<CaptionTestsCopy> {
  return (await configOrDefault('captionTests.copy', captionTestsCopySchema))[locale] as CaptionTestsCopy;
}
/** Saved Root copy for a language, falling back to the registered default. */
export const captionCopy = copyOf;
/** Errors that already carry their own customer wording (for example "voice too long"); the boundary passes them through. */
const worded = new WeakSet<OperationError>();
async function localised(error: unknown, locale: Locale): Promise<never> {
  if (error instanceof OperationError && worded.has(error)) throw error;
  const c = await copyOf(locale);
  const code: OperationErrorCode = error instanceof OperationError ? error.code : 'upstream_failure';
  const text = { invalid_request: c.errInvalid, unauthorized: c.errUnauthorized, forbidden: c.errForbidden, not_found: c.errNotFound, unavailable: c.errUnavailable, reconnect_required: c.errReconnect, conflict: c.errConflict, upstream_failure: c.errUpstream }[code];
  throw new OperationError(code, text);
}
const fail = (code: OperationErrorCode) => new OperationError(code, code);

async function audit(tx: Pick<Tx, '$executeRaw'>, workspaceId: string, actor: CaptionActor | null, action: string, detail: object, now: Date) {
  const payload = JSON.stringify({ ...detail, ...(actor?.apiKeyId ? { apiKeyId: actor.apiKeyId, authSource: 'api_key' } : {}) });
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, ${actor?.userId ?? null}, ${action}, ${payload}::jsonb, ${now})`;
  if (count !== 1) throw fail('unavailable');
}

/** Lock the workspace, member and account so a role change or suspension cannot slip between check and write. */
async function lockActor(tx: Tx, actor: CaptionActor) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT m."userId" AS id FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL AND w."suspendedAt" IS NULL FOR SHARE OF w FOR UPDATE OF m, u`;
  if (!rows.length) throw fail('forbidden');
}

// ------------------------------------------------------------------ read

export type CaptionTestPost = { id: string; label: string; message: string; channels: Array<{ id: string; name: string; publishedAt: string | null }> };
export type CaptionTestView = {
  id: string; name: string; status: 'running' | 'decided' | 'inconclusive'; reason: string | null; winnerLabel: string | null; lift: number | null;
  hours: number; minViews: number; createdAt: string; dueAt: string | null; decidedAt: string | null; learnedAt: string | null; results: CaptionResult[]; posts: CaptionTestPost[];
};
type TestRow = { id: string; name: string; hours: number; minViews: number; status: string; reason: string | null; winnerLabel: string | null; lift: number | null; results: unknown; decidedAt: Date | null; learnedAt: Date | null; createdAt: Date };
type PostRow = { id: string; testId: string; label: string | null; message: string; channels: Array<{ id: string; name: string; publishedAt: string | null }> };

export async function listCaptionTests(actor: CaptionActor, deps: CaptionDeps = {}): Promise<{ tests: CaptionTestView[]; canLearn: boolean; canStart: boolean; limits: { minCaptions: number; maxCaptions: number; defaultHours: number; minHours: number; maxHours: number; defaultMinViews: number; maxMinViews: number; captionMaxCharacters: number; nameMaxCharacters: number; targetLimit: number } }> {
  const locale = deps.locale ?? 'en';
  try {
    const auth = await authorizeAi(actor, LIST_FEATURE, 'read');
    const policy = await policyOf();
    // Results settle lazily as well as in the worker, so a reader never waits for the next pass. Best effort.
    await settleCaptionTests({ workspaceId: actor.workspaceId, now: deps.now, performance: deps.performance }).catch(() => undefined);
    const rows = await prisma.$queryRaw<TestRow[]>`SELECT id, name, hours, "minViews", status, reason, "winnerLabel", lift, results, "decidedAt", "learnedAt", "createdAt" FROM caption_tests WHERE "workspaceId" = ${actor.workspaceId} ORDER BY "createdAt" DESC, id DESC LIMIT ${policy.listLimit}`;
    const ids = rows.map(r => r.id);
    const posts = ids.length ? await prisma.$queryRaw<PostRow[]>`
      SELECT p.id, p."captionTestId" AS "testId", p."captionLabel" AS label, p.message,
        COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'publishedAt', pt."publishedAt") ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS channels
      FROM posts p LEFT JOIN post_targets pt ON pt."postId" = p.id LEFT JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId"
      WHERE p."workspaceId" = ${actor.workspaceId} AND p."captionTestId" = ANY(${ids}::text[]) GROUP BY p.id ORDER BY p."captionLabel" ASC, p.id ASC` : [];
    const allowed = auth.allowedTargetIds;
    const tests: CaptionTestView[] = [];
    for (const row of rows) {
      const own = posts.filter(p => p.testId === row.id);
      // A member limited to some channels sees only the tests that ran entirely on their channels.
      if (allowed && !own.every(p => p.channels.every(c => allowed.includes(c.id)))) continue;
      const times = own.flatMap(p => p.channels.map(c => c.publishedAt)).filter((t): t is string => Boolean(t)).map(t => new Date(t).getTime());
      const results = Array.isArray(row.results) ? row.results as CaptionResult[] : [];
      tests.push({
        id: row.id, name: row.name, status: row.status as CaptionTestView['status'], reason: row.reason, winnerLabel: row.winnerLabel, lift: row.lift, hours: row.hours, minViews: row.minViews,
        createdAt: row.createdAt.toISOString(), dueAt: times.length ? new Date(Math.max(...times) + row.hours * 3_600_000).toISOString() : null, decidedAt: row.decidedAt?.toISOString() ?? null, learnedAt: row.learnedAt?.toISOString() ?? null,
        results, posts: own.map(p => ({ id: p.id, label: p.label ?? '?', message: p.message, channels: p.channels })),
      });
    }
    const can = async (feature: string) => { try { await authorizeAi(actor, feature, 'write'); return true; } catch { return false; } };
    const [canLearn, canStart] = await Promise.all([can(LEARN_FEATURE), can(START_FEATURE)]);
    const { minCaptions, maxCaptions, defaultHours, minHours, maxHours, defaultMinViews, maxMinViews, captionMaxCharacters, nameMaxCharacters, targetLimit } = policy;
    return { tests, canLearn, canStart, limits: { minCaptions, maxCaptions, defaultHours, minHours, maxHours, defaultMinViews, maxMinViews, captionMaxCharacters, nameMaxCharacters, targetLimit } };
  } catch (error) { return localised(error, locale); }
}

/** Posts that could be put into a test: not already in one, not failed, cancelled or rejected, with channels the member may use. */
export async function listTestablePosts(actor: CaptionActor, deps: CaptionDeps = {}): Promise<Array<{ id: string; message: string; status: string }>> {
  const locale = deps.locale ?? 'en';
  try {
    const auth = await authorizeAi(actor, START_FEATURE, 'write');
    const policy = await policyOf();
    const rows = await prisma.$queryRaw<Array<{ id: string; message: string; status: string; targets: string[] }>>`
      SELECT p.id, p.message, p.status::text AS status, COALESCE(array_agg(pt."targetId") FILTER (WHERE pt."targetId" IS NOT NULL), '{}') AS targets
      FROM posts p LEFT JOIN post_targets pt ON pt."postId" = p.id
      WHERE p."workspaceId" = ${actor.workspaceId} AND p."captionTestId" IS NULL AND p.status::text = ANY(${STARTABLE}::text[])
      GROUP BY p.id ORDER BY p."createdAt" DESC LIMIT ${policy.listLimit * 4}`;
    return rows.filter(r => r.targets.length && (!auth.allowedTargetIds || r.targets.every(t => auth.allowedTargetIds!.includes(t)))).slice(0, policy.listLimit * 2).map(({ id, message, status }) => ({ id, message: message.slice(0, 280), status }));
  } catch (error) { return localised(error, locale); }
}

// ------------------------------------------------------------------ start

/** Group two to four existing posts into one test; the first becomes caption A. */
export async function startCaptionTest(actor: CaptionActor, raw: unknown, deps: CaptionDeps = {}): Promise<{ id: string; ok: true }> {
  const locale = deps.locale ?? 'en';
  try {
    const policy = await policyOf();
    const parsed = startSchema(policy).safeParse(raw);
    if (!parsed.success || parsed.data.confirmation !== START_CONFIRMATION || new Set(parsed.data.postIds).size !== parsed.data.postIds.length) throw fail('invalid_request');
    await authorizeAi(actor, START_FEATURE, 'write');
    const input = parsed.data; const now = (deps.now ?? (() => new Date()))(); const id = randomUUID();
    await withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`captiontests:${actor.workspaceId}`}))::text`;
      await lockActor(tx, actor);
      const auth = await authorizeAi(actor, START_FEATURE, 'write');
      await tx.$queryRaw`SELECT id FROM posts WHERE id = ANY(${input.postIds}::text[]) AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      const posts = await tx.$queryRaw<Array<{ id: string; message: string; status: string; testId: string | null; targets: string[] }>>`
        SELECT p.id, p.message, p.status::text AS status, p."captionTestId" AS "testId", COALESCE(array_agg(pt."targetId") FILTER (WHERE pt."targetId" IS NOT NULL), '{}') AS targets
        FROM posts p LEFT JOIN post_targets pt ON pt."postId" = p.id WHERE p.id = ANY(${input.postIds}::text[]) AND p."workspaceId" = ${actor.workspaceId} GROUP BY p.id`;
      if (posts.length !== input.postIds.length) throw fail('not_found');
      for (const post of posts) {
        if (post.testId || !STARTABLE.includes(post.status) || !post.targets.length) throw fail('conflict');
        if (auth.allowedTargetIds && post.targets.some(t => !auth.allowedTargetIds!.includes(t))) throw fail('forbidden');
      }
      const first = posts.find(p => p.id === input.postIds[0])!;
      const name = (input.name || first.message.trim().split('\n')[0] || '').slice(0, policy.nameMaxCharacters);
      await tx.$executeRaw`INSERT INTO caption_tests (id, "workspaceId", name, hours, "minViews", status, "createdById", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${name}, ${input.hours ?? policy.defaultHours}, ${input.minViews ?? policy.defaultMinViews}, 'running', ${actor.userId}, ${now})`;
      for (const [index, postId] of input.postIds.entries()) {
        const changed = await tx.$executeRaw`UPDATE posts SET "captionTestId" = ${id}, "captionLabel" = ${LABELS[index]!} WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId} AND "captionTestId" IS NULL`;
        if (changed !== 1) throw fail('conflict');
      }
      await audit(tx, actor.workspaceId, actor, 'captionTest.started', { testId: id, captions: input.postIds.length }, now);
    }, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs }));
    return { id, ok: true };
  } catch (error) { return localised(error, locale); }
}

export const VARIANTS_CONFIRMATION = 'CREATE CAPTION TEST DRAFTS';

/** Drafts, test membership and both modules' audits commit atomically; publication stays an explicit Publishing action. */
export async function startCaptionVariants(actor: CaptionActor, raw: unknown, deps: CaptionDeps = {}): Promise<{ id: string; ok: true; postIds: string[] }> {
  const locale = deps.locale ?? 'en';
  try {
    const policy = await policyOf();
    const parsed = z.object({
      name: z.string().trim().max(policy.nameMaxCharacters).optional(), hours: z.number().int().min(policy.minHours).max(policy.maxHours).optional(), minViews: z.number().int().min(1).max(policy.maxMinViews).optional(),
      captions: z.array(z.string().trim().min(1).max(policy.captionMaxCharacters)).min(policy.minCaptions).max(policy.maxCaptions),
      targetIds: z.array(z.string().min(1).max(200)).min(1).max(policy.targetLimit),
      link: z.string().url().optional(), confirmation: z.literal(VARIANTS_CONFIRMATION),
    }).strict().safeParse(raw);
    if (!parsed.success) throw fail('invalid_request');
    const input = parsed.data;
    if (new Set(input.captions).size !== input.captions.length || new Set(input.targetIds).size !== input.targetIds.length) throw fail('invalid_request');
    const auth = await authorizeAi(actor, START_FEATURE, 'write');
    if (auth.allowedTargetIds && input.targetIds.some(id => !auth.allowedTargetIds!.includes(id))) throw fail('forbidden');
    const id = randomUUID(); const now = (deps.now ?? (() => new Date()))();
    return await createPublishingDraftBatch({ userId: actor.userId, workspaceId: actor.workspaceId, allowedTargetIds: auth.allowedTargetIds }, input.captions.map(message => ({ message, firstComment: '', targetIds: input.targetIds, ...(input.link ? { link: input.link } : {}) })), async (tx, postIds) => {
      await lockActor(tx, actor);
      const current = await authorizeAi(actor, START_FEATURE, 'write');
      if (current.allowedTargetIds && input.targetIds.some(target => !current.allowedTargetIds!.includes(target))) throw fail('forbidden');
      const name = (input.name || input.captions[0]!).slice(0, policy.nameMaxCharacters);
      await tx.$executeRaw`INSERT INTO caption_tests (id, "workspaceId", name, hours, "minViews", status, "createdById", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${name}, ${input.hours ?? policy.defaultHours}, ${input.minViews ?? policy.defaultMinViews}, 'running', ${actor.userId}, ${now})`;
      for (const [index, postId] of postIds.entries()) {
        const changed = await tx.$executeRaw`UPDATE posts SET "captionTestId" = ${id}, "captionLabel" = ${LABELS[index]!} WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId} AND "captionTestId" IS NULL`;
        if (changed !== 1) throw fail('conflict');
      }
      await audit(tx, actor.workspaceId, actor, 'captionTest.started', { testId: id, captions: postIds.length, source: 'variants', postIds }, now);
      return { id, ok: true as const, postIds };
    });
  } catch (error) { return localised(error, locale); }
}

/** Both transports expose the same mutually exclusive input modes. */
export function startCaptionTestInput(actor: CaptionActor, raw: unknown, deps: CaptionDeps = {}) {
  return raw && typeof raw === 'object' && 'captions' in raw ? startCaptionVariants(actor, raw, deps) : startCaptionTest(actor, raw, deps);
}

// ------------------------------------------------------------------ learn

/** Add a decided test's winning caption, as a sentence, to the workspace writing voice the AI uses. */
export async function learnCaptionTest(actor: CaptionActor, raw: unknown, deps: CaptionDeps = {}): Promise<{ saved: true; already: boolean }> {
  const locale = deps.locale ?? 'en';
  const copy = await copyOf(locale);
  try {
    const policy = await policyOf();
    const parsed = learnSchema.safeParse(raw);
    if (!parsed.success || parsed.data.confirmation !== learnConfirmation(parsed.data.id)) throw fail('invalid_request');
    await authorizeAi(actor, LEARN_FEATURE, 'write');
    const { id } = parsed.data; const now = (deps.now ?? (() => new Date()))();
    return await withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`captiontests:${actor.workspaceId}`}))::text`;
      await lockActor(tx, actor);
      const auth = await authorizeAi(actor, LEARN_FEATURE, 'write');
      const tests = await tx.$queryRaw<Array<{ status: string; winnerLabel: string | null; lift: number | null; results: unknown; learnedAt: Date | null }>>`SELECT status, "winnerLabel", lift, results, "learnedAt" FROM caption_tests WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      const test = tests[0];
      if (!test) throw fail('not_found');
      if (test.status !== 'decided' || !test.winnerLabel) throw fail('conflict');
      if (test.learnedAt) return { saved: true as const, already: true };
      const posts = await tx.$queryRaw<Array<{ label: string | null; message: string; targets: string[] }>>`
        SELECT p."captionLabel" AS label, p.message, COALESCE(array_agg(pt."targetId") FILTER (WHERE pt."targetId" IS NOT NULL), '{}') AS targets
        FROM posts p LEFT JOIN post_targets pt ON pt."postId" = p.id WHERE p."captionTestId" = ${id} AND p."workspaceId" = ${actor.workspaceId} GROUP BY p.id`;
      // The test changes workspace-wide writing, so a member limited to some channels may not learn from one that ran beyond them.
      if (auth.allowedTargetIds && posts.some(p => p.targets.some(t => !auth.allowedTargetIds!.includes(t)))) throw fail('forbidden');
      const results = Array.isArray(test.results) ? test.results as CaptionResult[] : [];
      const runnerUp = results.filter(r => r.label !== test.winnerLabel).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
      const winner = posts.find(p => p.label === test.winnerLabel); const loser = posts.find(p => p.label === runnerUp?.label);
      if (!winner || !loser) throw fail('conflict');
      const workspace = await tx.$queryRaw<Array<{ voice: string | null; locale: string }>>`SELECT "aiBrandVoice" AS voice, "defaultLocale"::text AS locale FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
      const ownCopy = workspace[0]?.locale === 'fr' ? await copyOf('fr') : await copyOf('en');
      const line = learningLine(ownCopy, winner.message.trim(), loser.message.trim(), test.lift, policy.learnClipCharacters);
      const voice = [workspace[0]?.voice?.trim(), line].filter(Boolean).join('\n');
      // A voice near its limit is left as it is rather than cut.
      if (voice.length > WORKSPACE_OPERATION_BOUNDS.aiBrandVoice) { const noRoom = new OperationError('conflict', copy.learnNoRoom); worded.add(noRoom); throw noRoom; }
      await tx.$executeRaw`UPDATE workspaces SET "aiBrandVoice" = ${voice} WHERE id = ${actor.workspaceId}`;
      await tx.$executeRaw`UPDATE caption_tests SET "learnedAt" = ${now} WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
      await audit(tx, actor.workspaceId, actor, 'captionTest.learned', { testId: id, characters: line.length }, now);
      return { saved: true as const, already: false };
    }, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs }));
  } catch (error) { return localised(error, locale); }
}

// ------------------------------------------------------------------ settle (worker and reads)

const defaultPerformance: PerformanceReader = async (provider, request) => {
  const host = await platformAnalytics(provider);
  return host?.postPerformance ? host.postPerformance(request) : null;
};

/**
 * Decide every running test that is due, from figures the platform module stored. Database and stored
 * data only; no provider request. A test is claimed by its status, so two workers record one verdict.
 * Returns how many tests were settled.
 */
export async function settleCaptionTests(options: { workspaceId?: string; now?: () => Date; performance?: PerformanceReader } = {}): Promise<number> {
  const policy = await policyOf();
  const now = (options.now ?? (() => new Date()))(); const read = options.performance ?? defaultPerformance;
  const tests = options.workspaceId
    ? await prisma.$queryRaw<Array<{ id: string; workspaceId: string; hours: number; minViews: number }>>`SELECT id, "workspaceId", hours, "minViews" FROM caption_tests WHERE status = 'running' AND "workspaceId" = ${options.workspaceId} ORDER BY "createdAt" ASC LIMIT ${policy.evaluationBatch}`
    : await prisma.$queryRaw<Array<{ id: string; workspaceId: string; hours: number; minViews: number }>>`SELECT id, "workspaceId", hours, "minViews" FROM caption_tests WHERE status = 'running' ORDER BY "createdAt" ASC LIMIT ${policy.evaluationBatch}`;
  let settled = 0;
  for (const test of tests) {
    const posts = await prisma.$queryRaw<Array<{ id: string; label: string | null; status: string }>>`SELECT id, "captionLabel" AS label, status::text AS status FROM posts WHERE "captionTestId" = ${test.id} AND "workspaceId" = ${test.workspaceId}`;
    const targets = await prisma.$queryRaw<Array<{ postId: string; targetId: string; status: string; publishedAt: Date | null; provider: string | null }>>`
      SELECT pt."postId", pt."targetId", pt.status::text AS status, pt."publishedAt", sa.provider FROM post_targets pt JOIN posts p ON p.id = pt."postId"
      LEFT JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId" LEFT JOIN social_accounts sa ON sa.id = t."socialAccountId"
      WHERE p."captionTestId" = ${test.id} AND p."workspaceId" = ${test.workspaceId}`;
    let outcome: (Verdict & { results?: CaptionResult[] }) | null = null;
    const labels = new Set(posts.map(p => p.label));
    if (labels.size < 2 || posts.some(p => ['failed', 'cancelled', 'rejected'].includes(p.status)) || targets.some(t => ['failed', 'cancelled', 'skipped'].includes(t.status))) {
      outcome = { status: 'inconclusive', reason: 'not_published',winnerLabel: null, lift: null };
    } else if (targets.length && targets.every(t => t.status === 'published' && t.publishedAt)) {
      const due = Math.max(...targets.map(t => t.publishedAt!.getTime())) + test.hours * 3_600_000;
      if (now.getTime() >= due) {
        const figures: PostFigures[] = []; let fresh = true;
        const from = new Date(Math.min(...targets.map(t => t.publishedAt!.getTime())) - 86_400_000);
        const byChannel = new Map<string, string | null>(targets.map(t => [t.targetId, t.provider] as const));
        const labelOf = new Map(posts.map(p => [p.id, p.label ?? '?'] as const));
        for (const [targetId, provider] of byChannel) {
          const rows = provider ? await read(provider, { workspaceId: test.workspaceId, targetId, from, to: new Date(now.getTime() + 86_400_000), limit: policy.historyLimit, sort: 'publishedAt', direction: 'desc' }).catch(() => null) : null;
          for (const target of targets.filter(t => t.targetId === targetId)) {
            const row = rows?.find(r => r.postId === target.postId);
            if (!row?.measuredAt || row.measuredAt.getTime() < due) { fresh = false; continue; }
            figures.push({ label: labelOf.get(target.postId) ?? '?', views: firstMeasure(row.measures, policy.viewMeasures), engagements: sumMeasures(row.measures, policy.engagementMeasures) });
          }
        }
        if (fresh) { const results = tally(figures); outcome = { ...decide(results, test.minViews), results }; }
        else if (now.getTime() > due + policy.insightsGraceMs) outcome = { status: 'inconclusive', reason: 'no_insights', winnerLabel: null, lift: null, results: tally(figures) };
      }
    }
    if (!outcome) continue;
    const claimed = await prisma.$transaction(async tx => {
      const changed = await tx.$executeRaw`UPDATE caption_tests SET status = ${outcome!.status}, reason = ${outcome!.reason}, "winnerLabel" = ${outcome!.winnerLabel}, lift = ${outcome!.lift}, results = ${outcome!.results ? JSON.stringify(outcome!.results) : null}::jsonb, "decidedAt" = ${now} WHERE id = ${test.id} AND "workspaceId" = ${test.workspaceId} AND status = 'running'`;
      if (changed === 1) await audit(tx, test.workspaceId, null, 'captionTest.decided', { testId: test.id, status: outcome!.status, reason: outcome!.reason }, now);
      return changed;
    }, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs });
    settled += claimed;
  }
  return settled;
}
