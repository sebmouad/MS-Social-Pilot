import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { isStagingDryRun } from '@/server/jobs/staging';
import { replyToInbox } from './actions';
import { authorizeInbox } from './access';
import type { InboxReadActor } from './types';
import { AI_REPLIES_DEFAULTS, AI_REPLIES_PER_CONVERSATION_DAY, aiRepliesSchema, aiReplyPrompt, parseAiReply, precheck, type AiRepliesSettings, type AiReplyContext } from '../ai-replies';

/**
 * AI auto-replies (2026-11-17, see ../ai-replies.ts). After each Inbox sync, with the authority of an active owner:
 * visitor comments and Messenger messages that arrived after the switch was turned on, waited the chosen time, and got
 * no answer from the team are answered by the AI, or left for a person (owners and admins are notified) when negative
 * or sensitive. Every outcome is claimed in moderation_actions first, so nothing is answered twice, and shown in the
 * Inbox rules log with the reply that was sent.
 */
export type AiRepliesView = AiRepliesSettings & { enabledAt: string | null; channels: Array<{ id: string; name: string }>; week: { replied: number; handedOff: number; skipped: number; failed: number } };

/** Items handled per workspace in one pass; the rest wait for the next sync (the hourly AI limit applies anyway). */
const PER_RUN = 20;
/** Messenger allows a reply up to 24 h after the visitor's last message; keep a margin. */
const MESSAGE_WINDOW_MS = 23 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ceiling = (actor: InboxReadActor) => actor.allowedChannelIds === undefined ? {} : { allowedChannelIds: actor.allowedChannelIds };

type Row = { enabled: boolean; comments: boolean; messages: boolean; delayMinutes: number; targetIds: string[]; tone: string; enabledAt: Date | null };
async function settingsOf(workspaceId: string): Promise<Row | null> {
  const rows = await prisma.$queryRaw<Row[]>`SELECT enabled, comments, messages, "delayMinutes", "targetIds", tone, "enabledAt" FROM inbox_ai_replies WHERE "workspaceId" = ${workspaceId}`;
  return rows[0] ?? null;
}

export async function readAiReplies(actor: InboxReadActor): Promise<AiRepliesView> {
  const access = await authorizeInbox(actor, ceiling(actor), 'read');
  const row = await settingsOf(actor.workspaceId);
  const counts = access.channelIds.length ? await prisma.$queryRaw<Array<{ action: string; failed: boolean; count: number }>>`SELECT action, (error IS NOT NULL) AS failed, COUNT(*)::int AS count FROM moderation_actions
    WHERE "workspaceId" = ${actor.workspaceId} AND "ruleId" IS NULL AND action IN ('ai_reply', 'ai_handoff', 'ai_skip') AND "targetId" = ANY(${access.channelIds}::text[]) AND "createdAt" >= ${new Date(Date.now() - 7 * DAY_MS)}
    GROUP BY 1, 2` : [];
  const count = (action: string, failed: boolean) => counts.filter(c => c.action === action && c.failed === failed).reduce((sum, c) => sum + Number(c.count), 0);
  const settings = row ? { enabled: row.enabled, comments: row.comments, messages: row.messages, delayMinutes: row.delayMinutes, targetIds: row.targetIds.filter(id => access.channelIds.includes(id)), tone: row.tone as AiRepliesSettings['tone'] } : AI_REPLIES_DEFAULTS;
  return { ...settings, enabledAt: row?.enabledAt?.toISOString() ?? null, channels: access.channels.map(channel => ({ id: channel.id, name: channel.name })), week: { replied: count('ai_reply', false), handedOff: count('ai_handoff', false), skipped: count('ai_skip', false), failed: counts.filter(c => c.failed).reduce((sum, c) => sum + Number(c.count), 0) } };
}

/** Owners and admins only: it lets the AI speak for the Pages. The time it was switched on is when it starts looking. */
export async function saveAiReplies(actor: InboxReadActor, input: unknown): Promise<AiRepliesView> {
  const access = await authorizeInbox(actor, ceiling(actor), 'write');
  const role = await prisma.$queryRaw<Array<{ role: string }>>`SELECT role::text AS role FROM memberships WHERE "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId}`;
  if (!['owner', 'admin'].includes(role[0]?.role ?? '')) throw new OperationError('forbidden', 'Only owners and admins can change AI auto-replies.');
  const parsed = aiRepliesSchema.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', parsed.error.issues[0]?.message ?? 'Invalid AI auto-reply settings.');
  const value = parsed.data;
  if (value.targetIds.some(id => !access.channelIds.includes(id))) throw new OperationError('not_found', 'A chosen channel is not available.');
  await prisma.$executeRaw`INSERT INTO inbox_ai_replies ("workspaceId", enabled, comments, messages, "delayMinutes", "targetIds", tone, "enabledAt", "updatedAt", "updatedById")
    VALUES (${actor.workspaceId}, ${value.enabled}, ${value.comments}, ${value.messages}, ${value.delayMinutes}, ${value.targetIds}::text[], ${value.tone}, ${value.enabled ? new Date() : null}, NOW(), ${actor.userId})
    ON CONFLICT ("workspaceId") DO UPDATE SET enabled = EXCLUDED.enabled, comments = EXCLUDED.comments, messages = EXCLUDED.messages, "delayMinutes" = EXCLUDED."delayMinutes",
      "targetIds" = EXCLUDED."targetIds", tone = EXCLUDED.tone, "updatedAt" = NOW(), "updatedById" = EXCLUDED."updatedById",
      "enabledAt" = CASE WHEN EXCLUDED.enabled AND NOT inbox_ai_replies.enabled THEN NOW() WHEN EXCLUDED.enabled THEN inbox_ai_replies."enabledAt" ELSE NULL END`;
  await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'inbox.ai_replies_saved', ${JSON.stringify(value)}::jsonb, NOW())`;
  return readAiReplies(actor);
}

type Waiting = AiReplyContext & { id: string; remoteId: string; targetId: string; authorId: string | null; sentiment: string | null };

async function waitingComments(workspaceId: string, channelIds: string[], since: Date, before: Date, limit: number): Promise<Waiting[]> {
  if (!channelIds.length || limit < 1) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string; remoteId: string; targetId: string; channel: string; voice: string | null; author: string | null; authorId: string | null; text: string; sentiment: string | null; post: string | null; comment: string | null; link: string | null }>>`
    SELECT c.id, c."remoteId", t.id AS "targetId", t.name AS channel, t."brandVoice" AS voice, c."fromName" AS author, c."fromId" AS "authorId", c.message AS text, c.sentiment,
      p.message AS post, p."firstComment" AS comment,
      (SELECT l.permalink FROM wordpress_recipe_plans l WHERE l."postId" = p.id AND l."targetId" = t.id AND l.permalink IS NOT NULL LIMIT 1) AS link
    FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId" JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
    WHERE p."workspaceId" = ${workspaceId} AND t."workspaceId" = ${workspaceId} AND t.id = ANY(${channelIds}::text[])
      AND c."parentRemoteId" IS NULL AND c."sentById" IS NULL AND c."isHidden" = false AND c."resolvedAt" IS NULL AND length(trim(c.message)) > 0
      AND (c."fromId" IS NULL OR c."fromId" <> t."providerId") AND c."createdTime" >= ${since} AND c."createdTime" <= ${before}
      AND NOT EXISTS (SELECT 1 FROM post_comments r WHERE r."postTargetId" = c."postTargetId" AND r."parentRemoteId" = c."remoteId" AND (r."sentById" IS NOT NULL OR r."fromId" = t."providerId"))
      AND NOT EXISTS (SELECT 1 FROM moderation_actions m WHERE m."workspaceId" = ${workspaceId} AND m."targetId" = t.id AND m."remoteCommentId" = c."remoteId")
    ORDER BY c."createdTime" ASC LIMIT ${limit}`;
  return rows.map(row => ({ kind: 'comment' as const, id: row.id, remoteId: row.remoteId, targetId: row.targetId, channel: row.channel, voice: row.voice, author: row.author, authorId: row.authorId, text: row.text, sentiment: row.sentiment,
    post: [row.post, row.comment].filter(Boolean).join('\n\n') || null, link: row.link }));
}

async function waitingMessages(workspaceId: string, channelIds: string[], since: Date, before: Date, now: Date, limit: number): Promise<Waiting[]> {
  if (!channelIds.length || limit < 1) return [];
  // The latest message of each conversation, when it is the visitor's and nobody answered it since.
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; remoteId: string; targetId: string; channel: string; voice: string | null; author: string | null; authorId: string | null; text: string; providerId: string }>>`
    SELECT cv.id AS "conversationId", m."remoteId", t.id AS "targetId", t.name AS channel, t."brandVoice" AS voice, m."fromName" AS author, m."fromId" AS "authorId", m.message AS text, t."providerId"
    FROM conversations cv JOIN targets t ON t.id = cv."targetId"
    JOIN LATERAL (SELECT * FROM conversation_messages x WHERE x."conversationId" = cv.id ORDER BY x."createdTime" DESC, x.id DESC LIMIT 1) m ON true
    WHERE t."workspaceId" = ${workspaceId} AND t.id = ANY(${channelIds}::text[])
      AND m."sentById" IS NULL AND (m."fromId" IS NULL OR m."fromId" <> t."providerId") AND length(trim(COALESCE(m.message, ''))) > 0
      AND m."createdTime" >= ${since} AND m."createdTime" <= ${before} AND m."createdTime" >= ${new Date(now.getTime() - MESSAGE_WINDOW_MS)}
      AND (cv."resolvedAt" IS NULL OR cv."resolvedAt" < m."createdTime")
      AND NOT EXISTS (SELECT 1 FROM moderation_actions a WHERE a."workspaceId" = ${workspaceId} AND a."targetId" = t.id AND a."remoteCommentId" = m."remoteId")
    ORDER BY m."createdTime" ASC LIMIT ${limit}`;
  const out: Waiting[] = [];
  for (const row of rows) {
    const history = await prisma.$queryRaw<Array<{ fromId: string | null; sentById: string | null; message: string | null }>>`SELECT "fromId", "sentById", message FROM conversation_messages
      WHERE "conversationId" = ${row.conversationId} AND "remoteId" <> ${row.remoteId} ORDER BY "createdTime" DESC LIMIT 10`;
    out.push({ kind: 'message', id: row.conversationId, remoteId: row.remoteId, targetId: row.targetId, channel: row.channel, voice: row.voice, author: row.author, authorId: row.authorId, text: row.text, sentiment: null,
      history: history.reverse().filter(line => line.message?.trim()).map(line => ({ from: line.sentById || line.fromId === row.providerId ? 'page' as const : 'visitor' as const, text: line.message! })) });
  }
  return out;
}

/** AI replies already sent in this conversation in the last 24 h. */
async function aiRepliesInConversation(workspaceId: string, conversationId: string, now: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM moderation_actions a JOIN conversation_messages m ON m."remoteId" = a."remoteCommentId" AND m."conversationId" = ${conversationId}
    WHERE a."workspaceId" = ${workspaceId} AND a."ruleId" IS NULL AND a.action = 'ai_reply' AND a.error IS NULL AND a."createdAt" >= ${new Date(now.getTime() - DAY_MS)}`;
  return Number(rows[0]?.count ?? 0);
}

type Outcome = 'replied' | 'handed_off' | 'skipped' | 'failed' | 'stop';

async function handle(actor: InboxReadActor, item: Waiting, tone: AiRepliesSettings['tone'], now: Date, deps: { complete: (system: string, prompt: string) => Promise<string> }): Promise<Outcome> {
  const claimId = randomUUID();
  const claimed = await prisma.$executeRaw`INSERT INTO moderation_actions (id, "workspaceId", "ruleId", "ruleName", "targetId", "remoteCommentId", "authorId", "authorName", message, action, "createdAt")
    VALUES (${claimId}, ${actor.workspaceId}, NULL, 'ai', ${item.targetId}, ${item.remoteId}, ${item.authorId}, ${item.author}, ${item.text.slice(0, 2000)}, 'ai_reply', NOW())
    ON CONFLICT ("workspaceId", "targetId", "remoteCommentId") WHERE "ruleId" IS NULL AND action IN ('ai_reply', 'ai_handoff', 'ai_skip') DO NOTHING`;
  if (!claimed) return 'skipped';
  const settle = (action: 'ai_handoff' | 'ai_skip', note: string) => prisma.$transaction(async tx => {
    await tx.$executeRaw`UPDATE moderation_actions SET action = ${action}, "replyText" = ${note.slice(0, 500) || null} WHERE id = ${claimId}`;
    if (action === 'ai_handoff') await emitWorkspaceAlert(tx, { workspaceId: actor.workspaceId, eventId: `ai_handoff_${claimId}`, kind: 'moderation_alert', targetId: item.targetId });
  });
  const fail = (reason: string) => prisma.$executeRaw`UPDATE moderation_actions SET error = ${reason.slice(0, 500)} WHERE id = ${claimId}`;

  const pre = precheck(item.text, item.sentiment);
  if (pre === 'spam') { await settle('ai_skip', ''); return 'skipped'; }
  if (pre === 'negative') { await settle('ai_handoff', ''); return 'handed_off'; }
  if (item.kind === 'message' && await aiRepliesInConversation(actor.workspaceId, item.id, now) >= AI_REPLIES_PER_CONVERSATION_DAY) { await settle('ai_handoff', ''); return 'handed_off'; }

  const { system, prompt } = aiReplyPrompt(item, tone);
  let raw: string;
  try { raw = await deps.complete(system, prompt); }
  catch {
    // Over the AI limit or unavailable: release the claim; the next sync tries again.
    await prisma.$executeRaw`DELETE FROM moderation_actions WHERE id = ${claimId}`;
    return 'stop';
  }
  const decision = parseAiReply(raw, item.link);
  if (!decision) { await settle('ai_handoff', ''); return 'handed_off'; }
  if (decision.decision !== 'reply') {
    const skip = decision.decision === 'skip';
    await settle(skip ? 'ai_skip' : 'ai_handoff', decision.reason);
    return skip ? 'skipped' : 'handed_off';
  }
  const reply = decision.reply;
  await prisma.$executeRaw`UPDATE moderation_actions SET "replyText" = ${reply} WHERE id = ${claimId}`;
  try {
    await withWorkspaceOperation(actor.workspaceId, () => replyToInbox(actor, { kind: item.kind, id: item.id, text: reply }));
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'inbox.ai_reply_sent', ${JSON.stringify({ actionId: claimId, targetId: item.targetId, kind: item.kind, id: item.id })}::jsonb, NOW())`;
    return 'replied';
  } catch (error) {
    await fail(error instanceof OperationError ? error.message : 'The reply could not be confirmed. Check the conversation before answering again.');
    return 'failed';
  }
}

/** One workspace's pass, with the authority of `actor` (an active owner). */
export async function runAiRepliesFor(actor: InboxReadActor, now = new Date(), deps?: { complete: (system: string, prompt: string) => Promise<string> }) {
  const result = { examined: 0, replied: 0, handedOff: 0, skipped: 0, failed: 0 };
  const row = await settingsOf(actor.workspaceId);
  if (!row?.enabled || !row.enabledAt) return result;
  const access = await authorizeInbox(actor, ceiling(actor), 'write');
  const channelIds = row.targetIds.length ? row.targetIds.filter(id => access.channelIds.includes(id)) : access.channelIds;
  const since = new Date(Math.max(row.enabledAt.getTime(), now.getTime() - DAY_MS));
  const before = new Date(now.getTime() - row.delayMinutes * 60_000);
  const comments = row.comments ? await waitingComments(actor.workspaceId, channelIds, since, before, PER_RUN) : [];
  const messages = row.messages ? await waitingMessages(actor.workspaceId, channelIds, since, before, now, PER_RUN - comments.length) : [];
  const complete = deps?.complete ?? (async (system: string, prompt: string) => {
    const { autopilotComplete } = await import('@/modules/studio/server/ai');
    return autopilotComplete({ userId: actor.userId, workspaceId: actor.workspaceId }, 'inbox.autoreply', system, prompt, { maxTokens: 400 });
  });
  for (const item of [...messages, ...comments]) {
    result.examined++;
    const outcome = await handle(actor, item, row.tone as AiRepliesSettings['tone'], now, { complete });
    if (outcome === 'stop') break;
    if (outcome === 'replied') result.replied++; else if (outcome === 'handed_off') result.handedOff++; else if (outcome === 'skipped') result.skipped++; else result.failed++;
  }
  return result;
}

/** After each Inbox sync: every workspace with AI auto-replies on, with the authority of its first qualifying owner. */
export async function runAutomaticAiReplies(now = new Date()) {
  const total = { workspaces: 0, replied: 0, handedOff: 0, skipped: 0, failed: 0 };
  if (await isStagingDryRun()) return total;
  const workspaces = await prisma.$queryRaw<Array<{ workspaceId: string }>>`SELECT r."workspaceId" FROM inbox_ai_replies r JOIN workspaces w ON w.id = r."workspaceId" WHERE r.enabled = true AND w."suspendedAt" IS NULL ORDER BY r."workspaceId"`;
  for (const { workspaceId } of workspaces) {
    const owners = await prisma.$queryRaw<Array<{ userId: string }>>`SELECT m."userId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${workspaceId} AND m.role::text = 'owner' AND u."disabledAt" IS NULL ORDER BY m."userId"`;
    for (const { userId } of owners) {
      try {
        const result = await runAiRepliesFor({ userId, workspaceId }, now);
        total.workspaces++; total.replied += result.replied; total.handedOff += result.handedOff; total.skipped += result.skipped; total.failed += result.failed;
        break;
      } catch (error) {
        if (!(error instanceof OperationError)) { total.failed++; break; }
      }
    }
  }
  return total;
}
