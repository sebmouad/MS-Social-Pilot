import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { authorizeAi } from '@/modules/ai/server/access';
import { catalogFor, guarded, toolFailure, type Locale, type ToolViewerActor } from '@/modules/ai/server/tool-kit';
import { toolErrorCopy } from '@/modules/ai/server/tool-config';
import { createPublishingPost } from '../api-writes';
import { captionTestCopySchema, captionTestPolicySchema, type CaptionTestPolicy } from './config';
import { clipLine, learningLine, planCaptions, type CaptionResult } from './plan';

export const CAPTION_FEATURE = 'publishing/posts';
export const CREATE_CONFIRMATION = 'CREATE CAPTION TEST';
export const learnConfirmation = (id: string) => `SAVE LEARNING ${id}`;
/** Post options shared by every caption; the lifecycle service validates each. */
const SHARED_OPTIONS = ['firstComment', 'firstCommentDelayMinutes', 'link', 'media', 'imageUrl', 'videoUrl', 'destinationFormats', 'scheduleMode', 'labelId'] as const;
export const captionTestRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('get'), id: z.string().min(1) }).strict(),
  z.object({ action: z.literal('create'), captions: z.array(z.string()).min(2), targetIds: z.array(z.string().min(1)).min(1).max(500), scheduledAt: z.string(), hours: z.number().int().positive().optional(), minViews: z.number().int().positive().optional(), options: z.record(z.string(), z.unknown()).optional(), confirmation: z.string() }).strict(),
  z.object({ action: z.literal('learn'), id: z.string().min(1), confirmation: z.string() }).strict(),
]);
export type CaptionTestRow = { id: string; name: string; hours: number; minViews: number; status: string; reason: string | null; winnerLabel: string | null; lift: number | null; results: CaptionResult[] | null; decidedAt: Date | string | null; learnedAt: Date | string | null; createdAt: Date | string };

export const captionTestPolicy = async (): Promise<CaptionTestPolicy> => captionTestPolicySchema.parse(await runtimeConfig('publishing.captionTests.policy'));
export const captionTestCopy = (locale: Locale) => catalogFor('publishing.captionTests.copy', captionTestCopySchema, locale);
const COLUMNS = `t.id, t.name, t.hours, t."minViews", t.status, t.reason, t."winnerLabel", t.lift, t.results, t."decidedAt", t."learnedAt", t."createdAt"`;

/** A limited-scope actor sees only tests whose every post targets channels inside their scope. */
async function visibleTests(actor: ToolViewerActor, limit: number, id?: string): Promise<CaptionTestRow[]> {
  const allowed = actor.allowedTargetIds ? [...actor.allowedTargetIds] : null;
  return prisma.$queryRawUnsafe<CaptionTestRow[]>(`SELECT ${COLUMNS} FROM caption_tests t WHERE t."workspaceId" = $1 AND ($2::text IS NULL OR t.id = $2) AND ($3::text[] IS NULL OR NOT EXISTS (SELECT 1 FROM posts p JOIN post_targets pt ON pt."postId" = p.id WHERE p."captionTestId" = t.id AND NOT (pt."targetId" = ANY($3::text[])))) ORDER BY t."createdAt" DESC, t.id DESC LIMIT $4`, actor.workspaceId, id ?? null, allowed, limit);
}

async function audit(tx: Pick<typeof prisma, '$executeRaw'>, actor: ToolViewerActor, action: string, detail: object) {
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, now())`;
  if (count !== 1) throw new OperationError('unavailable', 'unavailable');
}

/** UI, REST and MCP share this: read tests, start one (one scheduled post per caption) or add the winner's style to channel voices. */
export async function captionTests(actor: ToolViewerActor, raw: unknown, deps: { locale?: Locale; now?: () => Date } = {}) {
  const locale = deps.locale ?? 'en';
  const errors = await toolErrorCopy(locale);
  return guarded(errors, async () => {
    const parsed = captionTestRequest.safeParse(raw);
    if (!parsed.success) throw toolFailure(errors, 'invalid_request');
    const input = parsed.data; const policy = await captionTestPolicy(); const copy = await captionTestCopy(locale);
    await authorizeAi(actor, CAPTION_FEATURE, input.action === 'list' || input.action === 'get' ? 'read' : 'write');
    if (input.action === 'list') return { tests: await visibleTests(actor, policy.listLimit) };
    if (input.action === 'get') {
      const [test] = await visibleTests(actor, 1, input.id);
      if (!test) throw toolFailure(errors, 'not_found');
      const captions = await prisma.$queryRaw<Array<{ label: string | null; message: string; postId: string; status: string }>>`SELECT p."captionLabel" AS label, p.message, p.id AS "postId", p.status::text AS status FROM posts p WHERE p."captionTestId" = ${input.id} AND p."workspaceId" = ${actor.workspaceId} ORDER BY p."captionLabel", p.id`;
      return { test, captions };
    }
    if (input.action === 'learn') return learn(actor, input.id, input.confirmation, policy, copy, errors);
    return create(actor, input, policy, copy, errors, (deps.now ?? (() => new Date()))());
  });
}

async function create(actor: ToolViewerActor, input: Extract<z.infer<typeof captionTestRequest>, { action: 'create' }>, policy: CaptionTestPolicy, copy: Record<string, string>, errors: Awaited<ReturnType<typeof toolErrorCopy>>, now: Date) {
  if (input.confirmation !== CREATE_CONFIRMATION) throw new OperationError('invalid_request', copy.confirmation!);
  const captions = input.captions.map(text => text.trim());
  if (captions.length < 2 || captions.length > policy.labels.length || captions.some(text => !text || text.length > policy.captionMaxCharacters) || new Set(captions).size !== captions.length) throw new OperationError('invalid_request', copy.needCaptions!);
  const hours = input.hours ?? policy.defaultHours; const minViews = input.minViews ?? policy.defaultMinViews;
  const start = new Date(input.scheduledAt);
  if (!/^\d{4}-\d\d-\d\dT/.test(input.scheduledAt) || !Number.isFinite(start.getTime()) || start.getTime() <= now.getTime() || hours > policy.maxHours || minViews > policy.maxMinViews || new Set(input.targetIds).size !== input.targetIds.length) throw toolFailure(errors, 'invalid_request');
  if (input.options && Object.keys(input.options).some(key => !(SHARED_OPTIONS as readonly string[]).includes(key))) throw toolFailure(errors, 'invalid_request');
  const testId = randomUUID();
  await prisma.$transaction(async tx => {
    const inserted = await tx.$executeRaw`INSERT INTO caption_tests (id, "workspaceId", name, hours, "minViews", status, "createdById", "createdAt") VALUES (${testId}, ${actor.workspaceId}, ${captions[0]!.split('\n')[0]!.slice(0, policy.nameCharacters)}, ${hours}, ${minViews}, 'running', ${actor.userId}, ${now})`;
    if (inserted !== 1) throw new OperationError('unavailable', 'unavailable');
    await audit(tx, actor, 'publishing.caption_test_created', { id: testId, captions: captions.length, targets: input.targetIds.length, hours, minViews });
  });
  const plan = planCaptions(input.targetIds, captions.length);
  const created: Array<{ label: string; postId: string; targetIds: string[] }> = []; let failures = 0; let firstError: unknown;
  for (const [index, part] of plan.entries()) {
    try {
      const options: Record<string, unknown> = {};
      for (const key of SHARED_OPTIONS) if (input.options?.[key] !== undefined) options[key] = input.options[key];
      const result = await createPublishingPost(actor, { ...options, message: captions[index], targetIds: part.targetIds, scheduledAt: new Date(start.getTime() + part.dayOffset * policy.dayOffsetMinutes * 60_000).toISOString(), confirmation: 'CREATE POST' }) as { id?: string; postId?: string };
      const postId = result.id ?? result.postId; if (!postId) throw new Error('no post id');
      const linked = await prisma.$executeRaw`UPDATE posts SET "captionTestId" = ${testId}, "captionLabel" = ${policy.labels[index]!} WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId}`;
      if (linked !== 1) throw new Error('not linked');
      created.push({ label: policy.labels[index]!, postId, targetIds: part.targetIds });
    } catch (error) { failures += 1; firstError ??= error; }
  }
  if (!created.length) { await prisma.$executeRaw`DELETE FROM caption_tests WHERE id = ${testId} AND "workspaceId" = ${actor.workspaceId}`; throw firstError instanceof OperationError ? firstError : toolFailure(errors, 'upstream_failure'); }
  if (failures) await prisma.$executeRaw`UPDATE caption_tests SET status = 'inconclusive', reason = 'not_published', "decidedAt" = now() WHERE id = ${testId} AND "workspaceId" = ${actor.workspaceId} AND status = 'running'`;
  return { id: testId, created, complete: failures === 0, message: failures ? copy.partial : copy.started };
}

async function learn(actor: ToolViewerActor, id: string, confirmation: string, policy: CaptionTestPolicy, copy: Record<string, string>, errors: Awaited<ReturnType<typeof toolErrorCopy>>) {
  if (confirmation !== learnConfirmation(id)) throw new OperationError('invalid_request', copy.confirmation!);
  const timeout = Number(await runtimeConfig('publishing.transactionTimeoutMs')); const maxWait = Number(await runtimeConfig('publishing.transactionMaxWaitMs'));
  return prisma.$transaction(async tx => {
    const [test] = await tx.$queryRaw<Array<{ status: string; winnerLabel: string | null; lift: number | null; results: CaptionResult[] | null; learnedAt: Date | null }>>`SELECT status, "winnerLabel", lift, results, "learnedAt" FROM caption_tests WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    if (!test) throw toolFailure(errors, 'not_found');
    if (test.status !== 'decided' || !test.winnerLabel || test.learnedAt) throw toolFailure(errors, 'conflict');
    const posts = await tx.$queryRaw<Array<{ label: string | null; message: string; targetId: string }>>`SELECT p."captionLabel" AS label, p.message, pt."targetId" FROM posts p JOIN post_targets pt ON pt."postId" = p.id WHERE p."captionTestId" = ${id} AND p."workspaceId" = ${actor.workspaceId}`;
    // A limited-scope member can only teach channels they may use; the test must lie inside their scope.
    if (actor.allowedTargetIds && posts.some(p => !actor.allowedTargetIds!.includes(p.targetId))) throw toolFailure(errors, 'forbidden');
    const runnerUp = [...(test.results ?? [])].filter(r => r.label !== test.winnerLabel).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
    const winner = posts.find(p => p.label === test.winnerLabel); const loser = posts.find(p => p.label === runnerUp?.label);
    if (!winner || !loser) throw toolFailure(errors, 'conflict');
    const line = learningLine(test.lift !== null ? copy.learningLift! : copy.learning!, clipLine(winner.message.trim(), policy.learningClipCharacters), clipLine(loser.message.trim(), policy.learningClipCharacters), test.lift);
    const targetIds = [...new Set(posts.map(p => p.targetId))];
    const channels = await tx.$queryRaw<Array<{ id: string; brandVoice: string | null }>>`SELECT id, "brandVoice" FROM targets WHERE id = ANY(${targetIds}::text[]) AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    let updated = 0;
    for (const channel of channels) {
      const voice = [channel.brandVoice?.trim(), line].filter(Boolean).join('\n');
      // A voice already near the limit is left as it is rather than cut.
      if (voice.length > policy.voiceMaxCharacters) continue;
      updated += await tx.$executeRaw`UPDATE targets SET "brandVoice" = ${voice} WHERE id = ${channel.id} AND "workspaceId" = ${actor.workspaceId}`;
    }
    await tx.$executeRaw`UPDATE caption_tests SET "learnedAt" = now() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'publishing.caption_test_learned', { id, channels: updated });
    return { id, channelsUpdated: updated, message: copy.learnDone };
  }, { timeout, maxWait });
}
