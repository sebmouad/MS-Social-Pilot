import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizePublishing } from './access';
import { createLabelConfirmation, deleteLabelConfirmation, LABEL_CREATE_SCHEMA, LABEL_DELETE_SCHEMA, LABEL_SEARCH_SCHEMA, LABEL_UPDATE_SCHEMA, updateLabelConfirmation, type LabelInput, type LabelRecord, type LabelUsage } from '../labels';
import { LABEL_BOUNDS } from '../labels-config';
import type { PublishingActor, PublishingAuthorization } from './types';

/** Labels have their own install switch while inheriting the Posts entitlement and permission mapping. */
const FEATURE = 'publishing/labels' as const;
type Tx = Prisma.TransactionClient;
type Limits = Awaited<ReturnType<typeof bounds>>;
type LabelRow = { id: string; name: string; color: string; createdAt: Date; posts: bigint | number | null; foreignPosts: bigint | number | null; templates: bigint | number | null; foreignTemplates: bigint | number | null; contentMixRules: bigint | number | null; foreignContentMixRules: bigint | number | null };
const bad = () => new OperationError('invalid_request', 'Choose valid label details and confirm the exact action.');
const unavailable = () => new OperationError('unavailable', 'Labels are temporarily unavailable. Refresh and try again.');
const missing = () => new OperationError('not_found', 'This label is unavailable in the current workspace.');
const parse = <S extends import('zod').ZodTypeAny>(schema: S, input: unknown): import('zod').output<S> => { const result = schema.safeParse(input); if (!result.success) throw bad(); return result.data; };
async function protect<T>(operation: Promise<T>): Promise<T> { try { return await operation; } catch (error) { if (error instanceof OperationError) throw error; if (isUnique(error)) throw duplicate(); throw new OperationError('upstream_failure', 'The label operation could not be confirmed. Refresh the label list before trying again.'); } }
const isUnique = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return candidate.code === 'P2002' || candidate.code === '23505' || candidate.meta?.code === '23505';
};
const duplicate = () => new OperationError('conflict', 'A label with this name already exists in the current workspace.');
const num = (value: bigint | number | null) => Number(value ?? 0);
const hasForeignReferences = (row: LabelRow) => num(row.foreignPosts) + num(row.foreignTemplates) + num(row.foreignContentMixRules) > 0;

async function bounds() {
  try {
    const [pageSize, maxRows, maxQuery, maxName, timeout, maxWait, workspaceTimeout] = await Promise.all([
      runtimeConfig('publishing.labelPageSize'), runtimeConfig('publishing.labelMaxPerWorkspace'), runtimeConfig('publishing.labelSearchMaxCharacters'),
      runtimeConfig('publishing.labelNameMaxCharacters'), runtimeConfig('publishing.labelTransactionTimeoutMs'), runtimeConfig('publishing.labelTransactionMaxWaitMs'),
      runtimeConfig('data.workspaceOperationTimeoutMs'),
    ]);
    const inBounds = (value: unknown, range: { min: number; max: number }) => typeof value === 'number' && Number.isSafeInteger(value) && value >= range.min && value <= range.max;
    if (!inBounds(pageSize, LABEL_BOUNDS.pageSize) || !inBounds(maxRows, LABEL_BOUNDS.maxPerWorkspace) || !inBounds(maxQuery, LABEL_BOUNDS.maxSearchCharacters) || !inBounds(maxName, LABEL_BOUNDS.maxNameCharacters) || !inBounds(timeout, LABEL_BOUNDS.transactionTimeoutMs) || !inBounds(maxWait, LABEL_BOUNDS.transactionMaxWaitMs) || !inBounds(workspaceTimeout, LABEL_BOUNDS.workspaceTimeoutMs) || (timeout as number) + (maxWait as number) >= (workspaceTimeout as number)) throw unavailable();
    return { pageSize: pageSize as number, maxRows: maxRows as number, maxQuery: maxQuery as number, maxName: maxName as number, timeout: timeout as number, maxWait: maxWait as number };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}
async function transact<T>(workspaceId: string, limit: Limits, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: limit.timeout, maxWait: limit.maxWait }));
}
/** Locks the acting membership and user, then re-reads current authority inside the transaction. */
async function lockActor(tx: Tx, actor: PublishingActor, write: boolean): Promise<PublishingAuthorization> {
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  const state = rows[0];
  if (!state || state.disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  return authorizePublishing(actor, FEATURE, write ? 'write' : 'read');
}
/** Renaming or removing a label changes every post in the workspace, so it needs access to all channels. */
function requireWorkspaceWide(auth: PublishingAuthorization) {
  if (!auth.permissions?.pageScope?.all) throw new OperationError('forbidden', 'Changing or removing a label affects posts on every channel. Ask a member with access to all channels.');
}
async function audit(tx: Tx, actor: PublishingActor, action: string, detail: object) {
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (count !== 1) throw unavailable();
}
const toRecord = (row: LabelRow, withUsage: boolean): LabelRecord => ({ id: row.id, name: row.name, color: row.color, createdAt: row.createdAt, usage: withUsage ? { posts: num(row.posts), templates: num(row.templates), contentMixRules: num(row.contentMixRules) } : null });
async function selectOne(tx: Tx, workspaceId: string, id: string, lock = false): Promise<LabelRow | undefined> {
  const rows = lock
    ? await tx.$queryRaw<LabelRow[]>`SELECT l.id, l.name, l.color, l."createdAt", (SELECT COUNT(*) FROM post_labels pl JOIN posts p ON p.id = pl."postId" WHERE pl."labelId" = l.id AND p."workspaceId" = l."workspaceId") AS posts, (SELECT COUNT(*) FROM post_labels pl JOIN posts p ON p.id = pl."postId" WHERE pl."labelId" = l.id AND p."workspaceId" <> l."workspaceId") AS "foreignPosts", (SELECT COUNT(*) FROM post_templates t WHERE t."labelId" = l.id AND t."workspaceId" = l."workspaceId") AS templates, (SELECT COUNT(*) FROM post_templates t WHERE t."labelId" = l.id AND t."workspaceId" <> l."workspaceId") AS "foreignTemplates", (SELECT COUNT(*) FROM content_mix_rules r WHERE r."labelId" = l.id AND r."workspaceId" = l."workspaceId") AS "contentMixRules", (SELECT COUNT(*) FROM content_mix_rules r WHERE r."labelId" = l.id AND r."workspaceId" <> l."workspaceId") AS "foreignContentMixRules" FROM labels l WHERE l.id = ${id} AND l."workspaceId" = ${workspaceId} FOR UPDATE OF l`
    : await tx.$queryRaw<LabelRow[]>`SELECT l.id, l.name, l.color, l."createdAt", (SELECT COUNT(*) FROM post_labels pl JOIN posts p ON p.id = pl."postId" WHERE pl."labelId" = l.id AND p."workspaceId" = l."workspaceId") AS posts, (SELECT COUNT(*) FROM post_labels pl JOIN posts p ON p.id = pl."postId" WHERE pl."labelId" = l.id AND p."workspaceId" <> l."workspaceId") AS "foreignPosts", (SELECT COUNT(*) FROM post_templates t WHERE t."labelId" = l.id AND t."workspaceId" = l."workspaceId") AS templates, (SELECT COUNT(*) FROM post_templates t WHERE t."labelId" = l.id AND t."workspaceId" <> l."workspaceId") AS "foreignTemplates", (SELECT COUNT(*) FROM content_mix_rules r WHERE r."labelId" = l.id AND r."workspaceId" = l."workspaceId") AS "contentMixRules", (SELECT COUNT(*) FROM content_mix_rules r WHERE r."labelId" = l.id AND r."workspaceId" <> l."workspaceId") AS "foreignContentMixRules" FROM labels l WHERE l.id = ${id} AND l."workspaceId" = ${workspaceId}`;
  return rows[0];
}
async function nameTaken(tx: Tx, workspaceId: string, name: string, exceptId?: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE "workspaceId" = ${workspaceId} AND lower(name) = lower(${name}) AND id <> ${exceptId ?? ''} LIMIT 1`;
  return Boolean(rows[0]);
}
function exact(actual: string, expected: string) { if (actual !== expected) throw bad(); }
function validateBounds(value: LabelInput, limit: Limits) { if (value.name.length > limit.maxName) throw bad(); }

/** Workspace labels with usage counts. Usage is workspace-wide, so it is withheld from channel-restricted members. */
export async function readLabelPage(actor: PublishingActor, input: unknown = {}) {
  const limit = await bounds();
  const query = parse(LABEL_SEARCH_SCHEMA, input);
  if ((query.q?.length ?? 0) > limit.maxQuery) throw bad();
  const auth = await authorizePublishing(actor, FEATURE, 'read');
  const wide = Boolean(auth.permissions?.pageScope?.all);
  const page = query.page ?? 1;
  const search = query.q ?? '';
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await protect(prisma.$queryRaw<LabelRow[]>`SELECT l.id, l.name, l.color, l."createdAt", (SELECT COUNT(*) FROM post_labels pl JOIN posts p ON p.id = pl."postId" WHERE pl."labelId" = l.id AND p."workspaceId" = l."workspaceId") AS posts, 0::bigint AS "foreignPosts", (SELECT COUNT(*) FROM post_templates t WHERE t."labelId" = l.id AND t."workspaceId" = l."workspaceId") AS templates, 0::bigint AS "foreignTemplates", (SELECT COUNT(*) FROM content_mix_rules r WHERE r."labelId" = l.id AND r."workspaceId" = l."workspaceId") AS "contentMixRules", 0::bigint AS "foreignContentMixRules" FROM labels l WHERE l."workspaceId" = ${actor.workspaceId} AND (${search} = '' OR l.name ILIKE ${pattern}) ORDER BY l.name ASC, l.id ASC LIMIT ${limit.pageSize + 1} OFFSET ${(page - 1) * limit.pageSize}`);
  return { labels: rows.slice(0, limit.pageSize).map(row => toRecord(row, wide)), page, pageSize: limit.pageSize, hasMore: rows.length > limit.pageSize, query: search, workspaceWide: wide, limits: { maxSearchCharacters: limit.maxQuery, maxNameCharacters: limit.maxName } };
}

export async function createLabel(actor: PublishingActor, input: unknown) {
  const data = parse(LABEL_CREATE_SCHEMA, input); exact(data.confirmation, createLabelConfirmation(data.name));
  const { confirmation: _confirmation, ...label } = data;
  const limit = await bounds(); validateBounds(label, limit); await authorizePublishing(actor, FEATURE, 'write');
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, true);
    if (await nameTaken(tx, actor.workspaceId, label.name)) throw duplicate();
    const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM labels WHERE "workspaceId" = ${actor.workspaceId}`;
    if (Number(count[0]?.count ?? 0) >= limit.maxRows) throw new OperationError('conflict', 'This workspace has reached its label limit.');
    const id = `lbl_${randomUUID()}`;
    const inserted = await tx.$executeRaw`INSERT INTO labels (id, "workspaceId", name, color, "createdAt") VALUES (${id}, ${actor.workspaceId}, ${label.name}, ${label.color}, NOW())`;
    if (inserted !== 1) throw unavailable();
    const row = await selectOne(tx, actor.workspaceId, id);
    if (!row) throw unavailable();
    await audit(tx, actor, 'publishing.label_created', { labelId: id, name: label.name, color: label.color });
    await lockActor(tx, actor, true);
    return toRecord(row, Boolean(auth.permissions?.pageScope?.all));
  }));
}

export async function updateLabel(actor: PublishingActor, input: unknown) {
  const data = parse(LABEL_UPDATE_SCHEMA, input); exact(data.confirmation, updateLabelConfirmation(data.id));
  const { id, confirmation: _confirmation, ...label } = data;
  const limit = await bounds(); validateBounds(label, limit); requireWorkspaceWide(await authorizePublishing(actor, FEATURE, 'write'));
  return protect(transact(actor.workspaceId, limit, async tx => {
    requireWorkspaceWide(await lockActor(tx, actor, true));
    const before = await selectOne(tx, actor.workspaceId, id, true);
    if (!before) throw missing();
    if (await nameTaken(tx, actor.workspaceId, label.name, id)) throw duplicate();
    if (hasForeignReferences(before)) throw unavailable();
    const updated = await tx.$executeRaw`UPDATE labels SET name = ${label.name}, color = ${label.color} WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    if (updated !== 1) throw missing();
    const row = await selectOne(tx, actor.workspaceId, id);
    if (!row) throw missing();
    await audit(tx, actor, 'publishing.label_updated', { labelId: id, name: label.name, color: label.color, previousName: before.name, previousColor: before.color });
    requireWorkspaceWide(await lockActor(tx, actor, true));
    return toRecord(row, true);
  }));
}

export async function deleteLabel(actor: PublishingActor, input: unknown) {
  const data = parse(LABEL_DELETE_SCHEMA, input); exact(data.confirmation, deleteLabelConfirmation(data.id));
  const limit = await bounds(); requireWorkspaceWide(await authorizePublishing(actor, FEATURE, 'write'));
  return protect(transact(actor.workspaceId, limit, async tx => {
    requireWorkspaceWide(await lockActor(tx, actor, true));
    const row = await selectOne(tx, actor.workspaceId, data.id, true);
    if (!row) throw missing();
    if (hasForeignReferences(row)) throw unavailable();
    const usage: LabelUsage = { posts: num(row.posts), templates: num(row.templates), contentMixRules: num(row.contentMixRules) };
    // Legacy schema: post_labels and content_mix_rules cascade, post_templates.labelId is set to NULL.
    const deleted = await tx.$executeRaw`DELETE FROM labels WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (deleted !== 1) throw missing();
    await audit(tx, actor, 'publishing.label_deleted', { labelId: row.id, name: row.name, detached: usage });
    requireWorkspaceWide(await lockActor(tx, actor, true));
    return { id: row.id, deleted: true as const, detached: usage };
  }));
}
