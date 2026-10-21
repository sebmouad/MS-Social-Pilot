import { z } from 'zod';
import { Prisma } from '../../../../generated/client';
import type { InboxMetadata } from '@/platforms/types';

const text = z.string().nullable();
const fields = {
  authorPictureUrl: text,
  attachments: z.array(z.object({ type: text, url: text })),
  reactions: z.array(z.object({ type: z.string(), count: z.number().int().nonnegative().safe() })),
  permalink: text,
  threadId: text,
  participants: z.array(z.object({ id: text, name: text, pictureUrl: text.optional() })),
  labels: z.array(z.object({ id: z.string(), name: text })),
  folder: text,
};

/** Validate each observation independently: one malformed field must not erase the others.
 * Missing fields stay missing; an explicit empty array is a known empty result. */
export function inboxMetadata(value: unknown): InboxMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(fields)) {
    const parsed = schema.safeParse((value as Record<string, unknown>)[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return Object.keys(result).length ? result as InboxMetadata : undefined;
}

type Database = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;
export type InboxMetadataKind = 'conversation' | 'message' | 'comment';

/** The caller already authorized/locked the resource. Repeat tenant/resource checks in SQL.
 * Called only after the provider read and base upsert, inside that same write transaction. */
export async function storeInboxMetadata(tx: Database, scope: { workspaceId: string; targetId: string }, kind: InboxMetadataKind, id: string, value: unknown): Promise<void> {
  const metadata = inboxMetadata(value);
  if (!metadata) return;
  const json = JSON.stringify(metadata);
  if (kind === 'conversation') {
    await tx.$executeRaw`UPDATE conversations c SET "inboxMetadata" = COALESCE(c."inboxMetadata", '{}'::jsonb) || ${json}::jsonb
      FROM targets t WHERE c.id = ${id} AND c."targetId" = t.id AND t.id = ${scope.targetId} AND t."workspaceId" = ${scope.workspaceId}`;
  } else if (kind === 'message') {
    await tx.$executeRaw`UPDATE conversation_messages m SET "inboxMetadata" = COALESCE(m."inboxMetadata", '{}'::jsonb) || ${json}::jsonb
      FROM conversations c, targets t WHERE m.id = ${id} AND m."conversationId" = c.id AND c."targetId" = t.id AND t.id = ${scope.targetId} AND t."workspaceId" = ${scope.workspaceId}`;
  } else {
    await tx.$executeRaw`UPDATE post_comments c SET "inboxMetadata" = COALESCE(c."inboxMetadata", '{}'::jsonb) || ${json}::jsonb
      FROM post_targets pt, targets t, posts p WHERE c.id = ${id} AND c."postTargetId" = pt.id AND pt."targetId" = t.id AND pt."postId" = p.id
      AND t.id = ${scope.targetId} AND t."workspaceId" = ${scope.workspaceId} AND p."workspaceId" = ${scope.workspaceId}`;
  }
}

/** Read only already-authorized items; SQL rechecks both tenant and channel ceilings. */
export async function readInboxMetadata(db: Database, scope: { workspaceId: string; channelIds: readonly string[] }, kind: InboxMetadataKind, ids: string[]): Promise<Map<string, InboxMetadata>> {
  if (!ids.length || !scope.channelIds.length) return new Map();
  type Row = { id: string; metadata: unknown };
  const rows = kind === 'conversation' ? await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.id, c."inboxMetadata" AS metadata FROM conversations c JOIN targets t ON t.id = c."targetId"
    WHERE c.id IN (${Prisma.join(ids)}) AND t."workspaceId" = ${scope.workspaceId} AND t.id IN (${Prisma.join(scope.channelIds)})`)
    : kind === 'message' ? await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT m.id, m."inboxMetadata" AS metadata FROM conversation_messages m JOIN conversations c ON c.id = m."conversationId" JOIN targets t ON t.id = c."targetId"
    WHERE m.id IN (${Prisma.join(ids)}) AND t."workspaceId" = ${scope.workspaceId} AND t.id IN (${Prisma.join(scope.channelIds)})`)
    : await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.id, c."inboxMetadata" AS metadata FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
    WHERE c.id IN (${Prisma.join(ids)}) AND t."workspaceId" = ${scope.workspaceId} AND p."workspaceId" = ${scope.workspaceId} AND t.id IN (${Prisma.join(scope.channelIds)})`);
  return new Map(rows.flatMap(row => { const metadata = inboxMetadata(row.metadata); return metadata ? [[row.id, metadata] as const] : []; }));
}
