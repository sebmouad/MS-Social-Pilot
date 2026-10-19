import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/client';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { loadPermissions } from '@/server/permissions/loader';
import { inboxCapabilities } from '@/server/inbox/providers';
import { moderateInboxComment, replyToInbox } from '@/server/inbox/actions';
import { authorizeInbox } from './access';
import type { InboxReadActor } from './types';
import {
  fillModerationReply, matchesModerationRule, moderationActionSchema, moderationConfirmation, moderationRuleProblem,
  type ModerationRuleInput,
} from '../moderation';

/**
 * Inbox moderation rules shared by UI, HTTP and MCP. Rules are workspace rows
 * (`moderation_rules`); every action a run takes is claimed in
 * `moderation_actions` before dispatch, so a comment is acted on once per rule.
 * Dispatch reuses the shared Inbox hide/reply services, so current channel
 * scope, grants, deletion guards and platform capabilities apply unchanged.
 */
export type ModerationRuleRow = ModerationRuleInput & { id: string; createdAt: Date; updatedAt: Date };
export type ModerationLogRow = { id: string; ruleId: string | null; ruleName: string; targetId: string; authorName: string | null; message: string; action: string; error: string | null; undoneAt: Date | null; createdAt: Date; undoable: boolean };

const invalid = (message = 'Choose a valid moderation rule action.') => new OperationError('invalid_request', message);
const DAY_MS = 24 * 60 * 60 * 1000;

async function limits() {
  const values = await Promise.all([runtimeConfig('inbox.moderationRuleLimit'), runtimeConfig('inbox.moderationLogLimit'), runtimeConfig('inbox.moderationFreshHours'), runtimeConfig('inbox.moderationRunMaxComments')]);
  const checked = z.tuple([z.number().int().min(1).max(500), z.number().int().min(1).max(1000), z.number().int().min(1).max(720), z.number().int().min(1).max(5000)]).safeParse(values);
  if (!checked.success) throw new OperationError('unavailable', 'Moderation rules are currently unavailable.');
  const [ruleLimit, logLimit, freshHours, runMaxComments] = checked.data;
  return { ruleLimit, logLimit, freshHours, runMaxComments };
}

/** Whether this actor sees every channel (membership and credential ceiling). Rules for "all channels" need it. */
async function hasEveryChannel(actor: InboxReadActor): Promise<boolean> {
  if (actor.allowedChannelIds !== undefined) return false;
  const permissions = await loadPermissions(actor.userId, actor.workspaceId);
  return Boolean(permissions?.pageScope.all);
}
const ceiling = (actor: InboxReadActor) => actor.allowedChannelIds === undefined ? {} : { allowedChannelIds: actor.allowedChannelIds };

/** A rule is visible to an actor only when every channel it names is visible. */
function ruleVisible(targetIds: readonly string[], channelIds: readonly string[], every: boolean) {
  return targetIds.length === 0 ? every : targetIds.every(id => channelIds.includes(id));
}

async function audit(actor: InboxReadActor, action: string, detail: object, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}

async function readRules(workspaceId: string) {
  return prisma.$queryRaw<ModerationRuleRow[]>(Prisma.sql`SELECT id, name, enabled, "targetIds", match, keywords, action, "replyText", "dailyCap", "oncePerUser", "createdAt", "updatedAt" FROM moderation_rules WHERE "workspaceId" = ${workspaceId} ORDER BY "createdAt", id`);
}

export async function readInboxModeration(actor: InboxReadActor) {
  const access = await authorizeInbox(actor, ceiling(actor), 'read');
  const [cap, every] = await Promise.all([limits(), hasEveryChannel(actor)]);
  const rules = (await readRules(actor.workspaceId)).filter(rule => ruleVisible(rule.targetIds, access.channelIds, every));
  const log = access.channelIds.length ? await prisma.$queryRaw<Omit<ModerationLogRow, 'undoable'>[]>(Prisma.sql`SELECT id, "ruleId", "ruleName", "targetId", "authorName", message, action, error, "undoneAt", "createdAt" FROM moderation_actions WHERE "workspaceId" = ${actor.workspaceId} AND "targetId" = ANY(${access.channelIds}::text[]) ORDER BY "createdAt" DESC, id DESC LIMIT ${cap.logLimit}`) : [];
  return {
    ok: true as const,
    rules,
    log: log.map(row => ({ ...row, undoable: row.action === 'hide' && !row.error && !row.undoneAt })),
    channels: access.channels,
    canTargetAllChannels: every,
    limits: cap,
  };
}

function validateRule(rule: ModerationRuleInput, channelIds: readonly string[], every: boolean): ModerationRuleInput {
  const problem = moderationRuleProblem(rule);
  if (problem === 'keywords') throw invalid('Add at least one word to look for.');
  if (problem === 'reply') throw invalid('Write the reply to send.');
  const targetIds = [...new Set(rule.targetIds)];
  if (targetIds.length === 0 && !every) throw new OperationError('forbidden', 'Choose the channels this rule applies to.');
  if (targetIds.some(id => !channelIds.includes(id))) throw new OperationError('not_found', 'One or more chosen channels are unavailable.');
  return { ...rule, targetIds, keywords: [...new Set(rule.keywords)], replyText: rule.action === 'reply' ? rule.replyText : rule.replyText || null };
}

export async function performInboxModerationAction(actor: InboxReadActor, input: unknown) {
  const parsed = moderationActionSchema.safeParse(input);
  if (!parsed.success) throw invalid();
  const value = parsed.data;
  const expected = value.action === 'rule.create' ? moderationConfirmation.create(value.rule.name)
    : value.action === 'rule.update' ? moderationConfirmation.update(value.id)
    : value.action === 'rule.delete' ? moderationConfirmation.remove(value.id)
    : value.action === 'rules.run' ? moderationConfirmation.run(value.channelId)
    : moderationConfirmation.undo(value.id);
  if (value.confirmation !== expected) throw invalid(`Confirmation required: ${expected}`);
  if (value.action === 'rules.run') return runInboxModerationRules(actor, value.channelId);
  if (value.action === 'action.undo') return undoInboxModerationAction(actor, value.id);

  const access = await authorizeInbox(actor, ceiling(actor), 'write');
  const [cap, every] = await Promise.all([limits(), hasEveryChannel(actor)]);
  return withWorkspaceOperation(actor.workspaceId, async () => {
    const fresh = await authorizeInbox(actor, ceiling(actor), 'write');
    const channelIds = fresh.channelIds.filter(id => access.channelIds.includes(id));
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['inbox-moderation-rules', actor.workspaceId])}, 0))`;
      if (value.action === 'rule.create') {
        const rule = validateRule(value.rule, channelIds, every);
        const count = await tx.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*)::int AS count FROM moderation_rules WHERE "workspaceId" = ${actor.workspaceId}`;
        if (Number(count[0]?.count ?? 0) >= cap.ruleLimit) throw new OperationError('conflict', `This workspace already has the maximum of ${cap.ruleLimit} moderation rules.`);
        const id = randomUUID();
        await tx.$executeRaw`INSERT INTO moderation_rules (id, "workspaceId", name, enabled, "targetIds", match, keywords, action, "replyText", "dailyCap", "oncePerUser", "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${rule.name}, ${rule.enabled}, ${rule.targetIds}::text[], ${rule.match}, ${rule.keywords}::text[], ${rule.action}, ${rule.replyText}, ${rule.dailyCap}, ${rule.oncePerUser}, NOW(), NOW())`;
        await audit(actor, 'inbox.moderation_rule_created', { ruleId: id, targetIds: rule.targetIds, action: rule.action }, tx);
        return { ok: true as const, action: value.action, id };
      }
      const rows = await tx.$queryRaw<Array<{ targetIds: string[] }>>`SELECT "targetIds" FROM moderation_rules WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      if (!rows[0] || !ruleVisible(rows[0].targetIds, channelIds, every)) throw new OperationError('not_found', 'This moderation rule is unavailable.');
      if (value.action === 'rule.update') {
        const rule = validateRule(value.rule, channelIds, every);
        await tx.$executeRaw`UPDATE moderation_rules SET name = ${rule.name}, enabled = ${rule.enabled}, "targetIds" = ${rule.targetIds}::text[], match = ${rule.match}, keywords = ${rule.keywords}::text[], action = ${rule.action}, "replyText" = ${rule.replyText}, "dailyCap" = ${rule.dailyCap}, "oncePerUser" = ${rule.oncePerUser}, "updatedAt" = NOW() WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
        await audit(actor, 'inbox.moderation_rule_updated', { ruleId: value.id, targetIds: rule.targetIds, action: rule.action, enabled: rule.enabled }, tx);
      } else {
        await tx.$executeRaw`DELETE FROM moderation_rules WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
        await audit(actor, 'inbox.moderation_rule_deleted', { ruleId: value.id }, tx);
      }
      return { ok: true as const, action: value.action, id: value.id };
    });
  });
}

type Candidate = { id: string; remoteId: string; parentRemoteId: string | null; message: string | null; fromId: string | null; fromName: string | null; targetId: string; targetName: string; channelIdentity: string; provider: string | null };

/**
 * Check stored, recent comments on the actor's channels against enabled rules
 * and act through the shared Inbox services. Started by a person, so it uses
 * that person's current authority. Never throws for a single comment failure:
 * the failure is recorded in the log and the run continues.
 */
export async function runInboxModerationRules(actor: InboxReadActor, channelId: string | null, now = new Date()) {
  const access = await authorizeInbox(actor, ceiling(actor), 'write');
  const cap = await limits();
  const channelIds = channelId ? access.channelIds.filter(id => id === channelId) : access.channelIds;
  if (channelId && !channelIds.length) throw new OperationError('not_found', 'This channel is unavailable in the Inbox.');
  const every = await hasEveryChannel(actor);
  const rules = (await readRules(actor.workspaceId)).filter(rule => rule.enabled && ruleVisible(rule.targetIds, access.channelIds, every));
  if (!rules.length || !channelIds.length) return { ok: true as const, action: 'rules.run' as const, examined: 0, acted: 0, failed: 0, skipped: 0 };
  const since = new Date(now.getTime() - cap.freshHours * 60 * 60 * 1000);
  const candidates = await prisma.$queryRaw<Candidate[]>(Prisma.sql`
    SELECT c.id, c."remoteId", c."parentRemoteId", c.message, c."fromId", c."fromName", t.id AS "targetId", t.name AS "targetName", t."providerId" AS "channelIdentity", sa.provider
    FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId" JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId" LEFT JOIN social_accounts sa ON sa.id = t."socialAccountId"
    WHERE p."workspaceId" = ${actor.workspaceId} AND t."workspaceId" = ${actor.workspaceId} AND t.id = ANY(${channelIds}::text[])
      AND c."sentById" IS NULL AND c."isHidden" = false AND c."createdTime" >= ${since}
    ORDER BY c."createdTime" DESC, c.id DESC LIMIT ${cap.runMaxComments}`);
  const capabilities = new Map<string, Awaited<ReturnType<typeof inboxCapabilities>>>();
  const result = { ok: true as const, action: 'rules.run' as const, examined: candidates.length, acted: 0, failed: 0, skipped: 0 };
  for (const comment of candidates) {
    // The channel's own words, including replies sent from this app.
    if (comment.fromId && comment.fromId === comment.channelIdentity) continue;
    const provider = comment.provider;
    if (!provider) continue;
    if (!capabilities.has(provider)) capabilities.set(provider, await inboxCapabilities(provider));
    const supports = capabilities.get(provider)!;
    for (const rule of rules) {
      if (rule.targetIds.length && !rule.targetIds.includes(comment.targetId)) continue;
      if (!matchesModerationRule(rule, comment.message ?? '')) continue;
      if ((rule.action === 'hide' && !supports.hide) || (rule.action === 'reply' && (!supports.reply || comment.parentRemoteId !== null))) { result.skipped++; continue; }
      const today = await prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM moderation_actions WHERE "ruleId" = ${rule.id} AND "createdAt" >= ${new Date(now.getTime() - DAY_MS)} AND error IS NULL`;
      if (Number(today[0]?.count ?? 0) >= rule.dailyCap) { result.skipped++; continue; }
      if (rule.action === 'reply' && rule.oncePerUser && comment.fromId) {
        const answered = await prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM moderation_actions WHERE "ruleId" = ${rule.id} AND "authorId" = ${comment.fromId} AND action = 'reply' AND error IS NULL`;
        if (Number(answered[0]?.count ?? 0) > 0) { result.skipped++; continue; }
      }
      const text = rule.action === 'reply' ? fillModerationReply(rule.replyText ?? '', { name: comment.fromName, channel: comment.targetName }) : '';
      if (rule.action === 'reply' && !text) { result.skipped++; continue; }
      // Claimed before acting: another run finds the row and leaves the comment alone.
      const claimId = randomUUID();
      const claimed = await prisma.$executeRaw`INSERT INTO moderation_actions (id, "workspaceId", "ruleId", "ruleName", "targetId", "remoteCommentId", "authorId", "authorName", message, action, "createdAt") VALUES (${claimId}, ${actor.workspaceId}, ${rule.id}, ${rule.name}, ${comment.targetId}, ${comment.remoteId}, ${comment.fromId}, ${comment.fromName}, ${(comment.message ?? '').slice(0, 500)}, ${rule.action}, ${now}) ON CONFLICT ("ruleId", "remoteCommentId") DO NOTHING`;
      if (!claimed) break;
      try {
        if (rule.action === 'hide') await withWorkspaceOperation(actor.workspaceId, () => moderateInboxComment(actor, { id: comment.id, hidden: true }));
        else if (rule.action === 'reply') await withWorkspaceOperation(actor.workspaceId, () => replyToInbox(actor, { kind: 'comment', id: comment.id, text }));
        result.acted++;
        await audit(actor, 'inbox.moderation_rule_applied', { ruleId: rule.id, actionId: claimId, targetId: comment.targetId, commentId: comment.id, action: rule.action });
      } catch (error) {
        result.failed++;
        const reason = error instanceof OperationError ? error.message : 'The channel did not confirm this action.';
        await prisma.$executeRaw`UPDATE moderation_actions SET error = ${reason.slice(0, 500)} WHERE id = ${claimId} AND "workspaceId" = ${actor.workspaceId}`;
      }
      // One rule per comment: a hidden comment needs no reply as well.
      break;
    }
  }
  return result;
}

/** Put back what a rule hid. Replies are not undone here: delete them from the thread, which uses the durable deletion flow. */
export async function undoInboxModerationAction(actor: InboxReadActor, actionId: string) {
  const access = await authorizeInbox(actor, ceiling(actor), 'write');
  const rows = await prisma.$queryRaw<Array<{ id: string; targetId: string; remoteCommentId: string; action: string; error: string | null; undoneAt: Date | null; ruleName: string }>>`SELECT id, "targetId", "remoteCommentId", action, error, "undoneAt", "ruleName" FROM moderation_actions WHERE id = ${actionId} AND "workspaceId" = ${actor.workspaceId}`;
  const row = rows[0];
  if (!row || !access.channelIds.includes(row.targetId)) throw new OperationError('not_found', 'This moderation action is unavailable.');
  if (row.action !== 'hide' || row.error || row.undoneAt) throw new OperationError('conflict', 'This moderation action cannot be undone.');
  const comment = await prisma.postComment.findFirst({ where: { remoteId: row.remoteCommentId, postTarget: { targetId: row.targetId, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } }, select: { id: true } });
  if (!comment) throw new OperationError('not_found', 'The comment is no longer stored, so this action cannot be undone here.');
  await withWorkspaceOperation(actor.workspaceId, () => moderateInboxComment(actor, { id: comment.id, hidden: false }));
  const changed = await prisma.$executeRaw`UPDATE moderation_actions SET "undoneAt" = NOW(), "undoneById" = ${actor.userId} WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} AND "undoneAt" IS NULL`;
  await audit(actor, 'inbox.moderation_action_undone', { actionId: row.id, targetId: row.targetId, commentId: comment.id });
  return { ok: true as const, action: 'action.undo' as const, id: row.id, recorded: changed > 0 };
}
