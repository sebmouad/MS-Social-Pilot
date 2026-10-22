import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../../generated/client';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { loadEntitlements, canUseFeature } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { encryptSecret, decryptSecret } from '@/server/secret-crypto';
import { CHAT_CHANNELS_FEATURE } from '../manifest';
import { actionSchema, createSchema, updateSchema, chatConfirmation, type ChatActor, type ChatRow, type ChatView, CHAT_EVENTS } from '../contracts';
import { chatCopy, chatPolicy } from './policy';
import { deliverChat, validChatSecret, type ChatSecret } from './transport';
import { CHAT_COPY } from '../config';

type Tx = Prisma.TransactionClient;
const denied = () => new OperationError('forbidden', 'Only workspace owners and admins with notification access can manage team chats.');
const invalid = () => new OperationError('invalid_request', 'Check the destination details and exact confirmation.');
const unavailable = () => new OperationError('unavailable', 'Team chat destinations are temporarily unavailable.');
const exact = (actual: string, expected: string) => { if (actual !== expected) throw invalid(); };
const project = (row: ChatRow): ChatView => ({ id: row.id, kind: row.kind, name: row.name, events: row.events, enabled: row.enabled, hasError: row.hasError, lastSentAt: row.lastSentAt?.toISOString() ?? null });

/** Service authority never trusts a caller-supplied role, tenant or Root flag. */
async function authorize(actor: ChatActor, write: boolean) {
  if (!actor?.userId || !actor.workspaceId) throw denied();
  // Destinations receive workspace-wide events; a channel-restricted key cannot
  // elevate itself to create an exfiltration destination for the whole workspace.
  if (actor.allowedChannelIds !== undefined) throw denied();
  const [user, member, workspaces, entitlements, permissions, locales] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    prisma.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM workspaces WHERE id = ${actor.workspaceId}`,
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId),
    prisma.$queryRaw<Array<{ locale: string }>>`SELECT locale::text AS locale FROM users WHERE id = ${actor.userId}`,
  ]);
  const workspace = workspaces[0];
  if (!user || user.disabledAt || !workspace || workspace.suspendedAt || !member || !['owner', 'admin'].includes(member.role) || !entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !permissions.pageScope.all || !canUseFeature(entitlements, CHAT_CHANNELS_FEATURE) || !canAccessFeature(permissions, CHAT_CHANNELS_FEATURE, write ? 'write' : 'read')) throw denied();
  return locales[0]?.locale === 'fr' ? 'fr' as const : 'en' as const;
}

async function audit(tx: Tx, actor: ChatActor, action: string, id: string, outcome?: string) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${`notifications.chat.${action}`}, ${JSON.stringify({ id, ...(outcome ? { outcome } : {}) })}::jsonb, NOW())`;
}

/** Serialize with workspace changes/purge and lock membership before rechecking authority. */
async function change<T>(actor: ChatActor, run: (tx: Tx, policy: Awaited<ReturnType<typeof chatPolicy>>, locale: 'en' | 'fr') => Promise<T>): Promise<T> {
  try {
    await authorize(actor, true); const policy = await chatPolicy();
    return await prisma.$transaction(async tx => {
      const workspaces = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
      if (!workspaces[0] || workspaces[0].suspendedAt) throw denied();
      const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId }, select: { status: true } });
      if (purge && purge.status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
      await tx.$queryRaw`SELECT m.id FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
      const locale = await authorize(actor, true);
      return run(tx, policy, locale);
    }, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs });
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

async function list(actor: ChatActor) {
  await authorize(actor, false);
  const [policy, copy] = await Promise.all([chatPolicy(), chatCopy()]);
  const rows = await prisma.$queryRaw<ChatRow[]>`SELECT id, kind, name, events, enabled, "lastSentAt", ("lastError" IS NOT NULL) AS "hasError" FROM chat_channels WHERE "workspaceId" = ${actor.workspaceId} ORDER BY "createdAt", id LIMIT ${policy.maxChannels + 1}`;
  if (rows.length > policy.maxChannels) throw new OperationError('unavailable', 'The destination directory exceeds its Root limit.');
  return { channels: rows.map(project), policy, copy, events: CHAT_EVENTS };
}

async function create(actor: ChatActor, input: unknown) {
  const parsed = createSchema.safeParse(input); if (!parsed.success) throw invalid(); const value = parsed.data;
  exact(value.confirmation, chatConfirmation.create(value.name));
  return change(actor, async (tx, policy) => {
    if (value.name.length > policy.maxNameCharacters) throw invalid();
    const secret: ChatSecret = value.kind === 'slack' ? { url: value.url } : { botToken: value.botToken, chatId: value.chatId };
    if (!validChatSecret(value.kind, secret, policy)) throw invalid();
    const counts = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM chat_channels WHERE "workspaceId" = ${actor.workspaceId}`;
    if (!counts[0] || Number(counts[0].count) >= policy.maxChannels) throw new OperationError('conflict', 'The configured destination limit has been reached.');
    const id = randomUUID();
    await tx.$executeRaw`INSERT INTO chat_channels (id, "workspaceId", kind, name, secret, events, enabled, "createdAt") VALUES (${id}, ${actor.workspaceId}, ${value.kind}, ${value.name}, ${encryptSecret(JSON.stringify(secret))}, ${value.events}::text[], true, NOW())`;
    await audit(tx, actor, 'created', id);
    return { id, saved: true as const };
  });
}

async function existing(tx: Tx, actor: ChatActor, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; kind: string; secret: string; enabled: boolean }>>`SELECT id, kind, secret, enabled FROM chat_channels WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
  if (!rows[0]) throw new OperationError('not_found', 'This destination is unavailable in this workspace.');
  return rows[0];
}
async function update(actor: ChatActor, input: unknown) {
  const parsed = updateSchema.safeParse(input); if (!parsed.success) throw invalid(); const value = parsed.data;
  exact(value.confirmation, chatConfirmation.update(value.id));
  return change(actor, async (tx, policy) => {
    if (value.id.length > policy.maxIdentifierCharacters) throw invalid();
    await existing(tx, actor, value.id);
    if (value.enabled !== undefined) await tx.$executeRaw`UPDATE chat_channels SET enabled = ${value.enabled} WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (value.events !== undefined) await tx.$executeRaw`UPDATE chat_channels SET events = ${value.events}::text[] WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'updated', value.id);
    return { id: value.id, saved: true as const };
  });
}
async function remove(actor: ChatActor, input: unknown) {
  const parsed = actionSchema.safeParse(input); if (!parsed.success) throw invalid(); const value = parsed.data;
  exact(value.confirmation, chatConfirmation.delete(value.id));
  return change(actor, async (tx, policy) => {
    if (value.id.length > policy.maxIdentifierCharacters) throw invalid();
    await existing(tx, actor, value.id);
    await tx.$executeRaw`DELETE FROM chat_channels WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'deleted', value.id); return { id: value.id, deleted: true as const };
  });
}
async function test(actor: ChatActor, input: unknown) {
  const parsed = actionSchema.safeParse(input); if (!parsed.success) throw invalid(); const value = parsed.data;
  exact(value.confirmation, chatConfirmation.test(value.id));
  return change(actor, async (tx, policy, locale) => {
    if (value.id.length > policy.maxIdentifierCharacters) throw invalid();
    const row = await existing(tx, actor, value.id);
    // Audit the attempt before any I/O. Never expose decrypted material or a raw
    // legacy lastError, which can contain destination credentials.
    await audit(tx, actor, 'test_requested', value.id);
    const copy = await chatCopy();
    let outcome: 'accepted' | 'rejected' | 'uncertain' = 'rejected';
    try { outcome = await deliverChat(row.kind, JSON.parse(decryptSecret(row.secret)) as ChatSecret, copy[locale].testMessage, policy); } catch { /* invalid legacy secret */ }
    await tx.$executeRaw`UPDATE chat_channels SET "lastError" = ${outcome === 'accepted' ? null : outcome}, "lastSentAt" = CASE WHEN ${outcome === 'accepted'} THEN NOW() ELSE "lastSentAt" END WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'test_finished', value.id, outcome);
    return { id: value.id, outcome };
  });
}

/** Localized, Root-owned failures for every UI/REST/MCP caller. Raw persistence
 * and transport errors never become customer-facing strings. */
async function boundary<T>(actor: ChatActor, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    let locale: 'en' | 'fr' = 'en';
    try { if (actor?.userId) { const rows = await prisma.$queryRaw<Array<{ locale: string }>>`SELECT locale::text AS locale FROM users WHERE id = ${actor.userId}`; locale = rows[0]?.locale === 'fr' ? 'fr' : 'en'; } } catch { /* safe shipped language */ }
    const copy = (await chatCopy().catch(() => CHAT_COPY))[locale];
    const code = error instanceof OperationError ? error.code : 'unavailable';
    const message = code === 'invalid_request' ? copy.invalid : code === 'forbidden' || code === 'unauthorized' ? copy.forbidden : code === 'not_found' ? copy.notFound : code === 'conflict' ? copy.conflict : copy.unavailable;
    throw new OperationError(code, message);
  }
}
export const listChatChannels = (actor: ChatActor) => boundary(actor, () => list(actor));
export const createChatChannel = (actor: ChatActor, input: unknown) => boundary(actor, () => create(actor, input));
export const updateChatChannel = (actor: ChatActor, input: unknown) => boundary(actor, () => update(actor, input));
export const deleteChatChannel = (actor: ChatActor, input: unknown) => boundary(actor, () => remove(actor, input));
export const testChatChannel = (actor: ChatActor, input: unknown) => boundary(actor, () => test(actor, input));
