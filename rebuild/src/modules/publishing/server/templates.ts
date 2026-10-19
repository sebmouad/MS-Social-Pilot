import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizePublishing } from './access';
import { createTemplateConfirmation, deleteTemplateConfirmation, TEMPLATE_CREATE_SCHEMA, TEMPLATE_DELETE_SCHEMA, TEMPLATE_ID_SCHEMA, TEMPLATE_SEARCH_SCHEMA, TEMPLATE_UPDATE_SCHEMA, updateTemplateConfirmation, type TemplateInput, type TemplateRecord } from '../templates';
import { TEMPLATE_CONFIG } from '../templates-config';
import type { PublishingActor } from './types';

type Tx = Prisma.TransactionClient;
type TemplateRow = { id: string; name: string; category: string; body: string; hashtags: string; firstComment: string; firstCommentDelayMinutes: number; labelId: string | null; createdAt: Date; updatedAt: Date };
const bad = () => new OperationError('invalid_request', 'Choose valid template details and confirm the exact action.');
const unavailable = () => new OperationError('unavailable', 'Templates are temporarily unavailable. Refresh and try again.');
const missing = () => new OperationError('not_found', 'This template is unavailable in the current workspace.');
const parse = <S extends import('zod').ZodTypeAny>(schema: S, input: unknown): import('zod').output<S> => { const result = schema.safeParse(input); if (!result.success) throw bad(); return result.data; };
async function protect<T>(operation: Promise<T>): Promise<T> { try { return await operation; } catch (error) { if (error instanceof OperationError) throw error; if (isUnique(error)) throw new OperationError('conflict', 'A template with this name already exists in the current workspace.'); throw new OperationError('upstream_failure', 'The template operation could not be confirmed. Refresh the template list before trying again.'); } }

export async function templateBounds() {
  try {
    const [pageSize, maxRows, maxQuery, maxName, maxCategory, maxBody, maxHashtags, maxFirstComment, maxFirstCommentDelayMinutes, timeout, maxWait, workspaceTimeout] = await Promise.all([
      runtimeConfig('publishing.templatePageSize'), runtimeConfig('publishing.templateMaxPerWorkspace'), runtimeConfig('publishing.templateSearchMaxCharacters'),
      runtimeConfig('publishing.templateNameMaxCharacters'), runtimeConfig('publishing.templateCategoryMaxCharacters'), runtimeConfig('publishing.templateBodyMaxCharacters'),
      runtimeConfig('publishing.templateHashtagsMaxCharacters'), runtimeConfig('publishing.templateFirstCommentMaxCharacters'), runtimeConfig('publishing.maxFirstCommentDelayMinutes'), runtimeConfig('publishing.templateTransactionTimeoutMs'),
      runtimeConfig('publishing.templateTransactionMaxWaitMs'), runtimeConfig('data.workspaceOperationTimeoutMs'),
    ]);
    const values = [pageSize, maxRows, maxQuery, maxName, maxCategory, maxBody, maxHashtags, maxFirstComment, maxFirstCommentDelayMinutes, timeout, maxWait, workspaceTimeout];
    for (const definition of TEMPLATE_CONFIG) {
      if (definition.key === 'publishing.templateLabelLimit') continue;
      if (!definition.schema.safeParse(await runtimeConfig(definition.key)).success) throw unavailable();
    }
    if (!values.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || (timeout as number) + (maxWait as number) >= (workspaceTimeout as number)) throw unavailable();
    return { pageSize: pageSize as number, maxRows: maxRows as number, maxQuery: maxQuery as number, maxName: maxName as number, maxCategory: maxCategory as number, maxBody: maxBody as number, maxHashtags: maxHashtags as number, maxFirstComment: maxFirstComment as number, maxFirstCommentDelayMinutes: maxFirstCommentDelayMinutes as number, timeout: timeout as number, maxWait: maxWait as number };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}
function validateBounds(value: TemplateInput, limit: Awaited<ReturnType<typeof templateBounds>>) {
  if (value.name.length > limit.maxName || value.category.length > limit.maxCategory || value.body.length > limit.maxBody || value.hashtags.length > limit.maxHashtags || value.firstComment.length > limit.maxFirstComment || value.firstCommentDelayMinutes > limit.maxFirstCommentDelayMinutes) throw bad();
}
async function transact<T>(workspaceId: string, limit: Awaited<ReturnType<typeof templateBounds>>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: limit.timeout, maxWait: limit.maxWait }));
}
async function lockActor(tx: Tx, actor: PublishingActor, write: boolean) {
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  const state = rows[0];
  if (!state || state.disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  await authorizePublishing(actor, 'publishing/templates', write ? 'write' : 'read');
  return state;
}
async function audit(tx: Tx, actor: PublishingActor, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}

export async function readTemplatePage(actor: PublishingActor, input: unknown = {}) {
  const limit = await templateBounds();
  const query = parse(TEMPLATE_SEARCH_SCHEMA, input);
  if ((query.q?.length ?? 0) > limit.maxQuery) throw bad();
  await authorizePublishing(actor, 'publishing/templates', 'read');
  const page = query.page ?? 1;
  const search = query.q ?? '';
  const pattern = `%${search}%`;
  const rows = await protect(prisma.$queryRaw<TemplateRow[]>`SELECT id, name, category, body, hashtags, "firstComment", "firstCommentDelayMinutes", "labelId", "createdAt", "updatedAt" FROM post_templates WHERE "workspaceId" = ${actor.workspaceId} AND (${search} = '' OR name ILIKE ${pattern} OR category ILIKE ${pattern} OR body ILIKE ${pattern}) ORDER BY name ASC, id ASC LIMIT ${limit.pageSize + 1} OFFSET ${(page - 1) * limit.pageSize}`);
  return { templates: rows.slice(0, limit.pageSize), page, pageSize: limit.pageSize, hasMore: rows.length > limit.pageSize, query: query.q ?? '', limits: { maxSearchCharacters: limit.maxQuery, maxNameCharacters: limit.maxName, maxCategoryCharacters: limit.maxCategory, maxBodyCharacters: limit.maxBody, maxHashtagsCharacters: limit.maxHashtags, maxFirstCommentCharacters: limit.maxFirstComment, maxFirstCommentDelayMinutes: limit.maxFirstCommentDelayMinutes } };
}

/** Composer integration contract: select reusable content by workspace id; this read never creates a post. */
export async function readTemplateForComposer(actor: PublishingActor, id: unknown): Promise<TemplateRecord> {
  const checkedId = TEMPLATE_ID_SCHEMA.safeParse(id);
  if (!checkedId.success) throw bad();
  await authorizePublishing(actor, 'publishing/templates', 'read');
  const rows = await protect(prisma.$queryRaw<TemplateRow[]>`SELECT id, name, category, body, hashtags, "firstComment", "firstCommentDelayMinutes", "labelId", "createdAt", "updatedAt" FROM post_templates WHERE id = ${checkedId.data} AND "workspaceId" = ${actor.workspaceId} LIMIT 1`);
  if (!rows[0]) throw missing();
  return rows[0];
}

export async function readTemplateLabels(actor: PublishingActor): Promise<Array<{ id: string; name: string }>> {
  await authorizePublishing(actor, 'publishing/templates', 'read');
  const definition = TEMPLATE_CONFIG.find(item => item.key === 'publishing.templateLabelLimit')!;
  let cap: number;
  try { cap = definition.schema.parse(await runtimeConfig(definition.key)); } catch { throw unavailable(); }
  const rows = await protect(prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM labels WHERE "workspaceId" = ${actor.workspaceId} ORDER BY name ASC, id ASC LIMIT ${cap + 1}`);
  if (rows.length > cap) throw new OperationError('unavailable', 'The label directory is too large to load. Contact your workspace administrator.');
  return rows;
}

function exact(actual: string, expected: string) { if (actual !== expected) throw bad(); }
async function checkLabel(tx: Tx, actor: PublishingActor, labelId: string | null) {
  if (!labelId) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE id = ${labelId} AND "workspaceId" = ${actor.workspaceId} LIMIT 1`;
  if (!rows[0]) throw new OperationError('invalid_request', 'Choose a label from this workspace.');
}
function mutationProtect<T>(operation: Promise<T>) { return protect(operation).catch(error => { if (isUnique(error)) throw new OperationError('conflict', 'A template with this name already exists in the current workspace.'); throw error; }); }
function isUnique(error: unknown) { return Boolean(error && typeof error === 'object' && ('code' in error && ((error as { code?: unknown }).code === 'P2002' || (error as { code?: unknown }).code === '23505'))); }

export async function createTemplate(actor: PublishingActor, input: unknown) {
  const data = parse(TEMPLATE_CREATE_SCHEMA, input); exact(data.confirmation, createTemplateConfirmation(data.name));
  const { confirmation: _confirmation, ...template } = data;
  const limit = await templateBounds(); validateBounds(template, limit); await authorizePublishing(actor, 'publishing/templates', 'write');
  return mutationProtect(transact(actor.workspaceId, limit, async tx => {
    await lockActor(tx, actor, true); await checkLabel(tx, actor, template.labelId);
    const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_templates WHERE "workspaceId" = ${actor.workspaceId}`;
    if (Number(count[0]?.count ?? 0) >= limit.maxRows) throw new OperationError('conflict', 'This workspace has reached its template limit.');
    const id = `tpl_${randomUUID()}`;
    await tx.$executeRaw`INSERT INTO post_templates (id, "workspaceId", name, category, body, hashtags, "firstComment", "firstCommentDelayMinutes", "labelId", "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${template.name}, ${template.category}, ${template.body}, ${template.hashtags}, ${template.firstComment}, ${template.firstCommentDelayMinutes}, ${template.labelId}, NOW(), NOW())`;
    const rows = await tx.$queryRaw<TemplateRow[]>`SELECT id, name, category, body, hashtags, "firstComment", "firstCommentDelayMinutes", "labelId", "createdAt", "updatedAt" FROM post_templates WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    if (!rows[0]) throw unavailable(); await audit(tx, actor, 'publishing.template_created', { templateId: id, name: template.name }); await lockActor(tx, actor, true);
    return rows[0];
  }));
}

export async function updateTemplate(actor: PublishingActor, input: unknown) {
  const data = parse(TEMPLATE_UPDATE_SCHEMA, input); exact(data.confirmation, updateTemplateConfirmation(data.id));
  const { id, confirmation: _confirmation, ...template } = data;
  const limit = await templateBounds(); validateBounds(template, limit); await authorizePublishing(actor, 'publishing/templates', 'write');
  return mutationProtect(transact(actor.workspaceId, limit, async tx => {
    await lockActor(tx, actor, true); await checkLabel(tx, actor, template.labelId);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM post_templates WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    if (!locked[0]) throw missing();
    await tx.$executeRaw`UPDATE post_templates SET name = ${template.name}, category = ${template.category}, body = ${template.body}, hashtags = ${template.hashtags}, "firstComment" = ${template.firstComment}, "firstCommentDelayMinutes" = ${template.firstCommentDelayMinutes}, "labelId" = ${template.labelId}, "updatedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    const rows = await tx.$queryRaw<TemplateRow[]>`SELECT id, name, category, body, hashtags, "firstComment", "firstCommentDelayMinutes", "labelId", "createdAt", "updatedAt" FROM post_templates WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    if (!rows[0]) throw missing(); await audit(tx, actor, 'publishing.template_updated', { templateId: id, name: template.name }); await lockActor(tx, actor, true);
    return rows[0];
  }));
}

export async function deleteTemplate(actor: PublishingActor, input: unknown) {
  const data = parse(TEMPLATE_DELETE_SCHEMA, input); exact(data.confirmation, deleteTemplateConfirmation(data.id));
  if (!TEMPLATE_ID_SCHEMA.safeParse(data.id).success) throw bad();
  const limit = await templateBounds(); await authorizePublishing(actor, 'publishing/templates', 'write');
  return protect(transact(actor.workspaceId, limit, async tx => {
    await lockActor(tx, actor, true);
    const rows = await tx.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM post_templates WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const row = rows[0]; if (!row) throw missing();
    await tx.$executeRaw`DELETE FROM post_templates WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'publishing.template_deleted', { templateId: row.id, name: row.name }); await lockActor(tx, actor, true);
    return { id: row.id, deleted: true as const };
  }));
}
