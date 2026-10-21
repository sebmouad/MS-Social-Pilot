
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor } from '../../server/types';
import { createFieldConfirmation, dedupeOptions, deleteFieldConfirmation, FIELD_CREATE, FIELD_DELETE, FIELD_UPDATE, FIELD_VALUES, ID, setFieldValuesConfirmation, updateFieldConfirmation } from '../schemas';
import type { Tx } from './core';
import { assertMayEdit, audit, bad, bounds, exact, isUnique, lockActor, parse, POSTS, protect, requireWorkspaceAdmin, transact, visiblePost } from './core';

export type CustomFieldRecord = { id: string; name: string; kind: 'text' | 'choice'; options: string[]; position: number };
const duplicate = (errorText: PublishingErrorText = defaultPublishingErrorText) => new PublishingOperationError('conflict', 'collaboration_19', {}, errorText);
const missing = (errorText: PublishingErrorText = defaultPublishingErrorText) => new PublishingOperationError('not_found', 'collaboration_20', {}, errorText);

export async function readCustomFields(actor: PublishingActor): Promise<CustomFieldRecord[]> {
  const errorText = await loadPublishingErrorText();
  await authorizePublishing(actor, POSTS, 'read');
  const limit = await bounds();
  const rows = await protect(prisma.$queryRaw<CustomFieldRecord[]>`SELECT id, name, kind::text AS kind, options, position FROM custom_fields WHERE "workspaceId" = ${actor.workspaceId} ORDER BY position ASC, name ASC LIMIT ${limit.fieldLimit + 1}`);
  if (rows.length > limit.fieldLimit) throw new PublishingOperationError('unavailable', 'collaboration_21', {}, errorText);
  return rows;
}

export async function createCustomField(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(FIELD_CREATE, input, undefined, errorText); exact(data.confirmation, createFieldConfirmation(data.name), errorText);
  const limit = await bounds();
  const options = data.kind === 'choice' ? dedupeOptions(data.options) : [];
  if (options.length > limit.fieldOptionsLimit || data.name.length > limit.fieldNameMax || options.some(o => o.length > limit.fieldOptionMax)) throw bad(undefined, errorText);
  requireWorkspaceAdmin(await authorizePublishing(actor, POSTS, 'write'), errorText('actionCustomFields'), errorText);
  return protect(transact(actor.workspaceId, limit, async tx => {
    requireWorkspaceAdmin(await lockActor(tx, actor, POSTS, true), errorText('actionCustomFields'), errorText);
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM custom_fields WHERE "workspaceId" = ${actor.workspaceId}`;
    const count = Number(rows[0]?.count ?? 0);
    if (count >= limit.fieldLimit) throw new PublishingOperationError('conflict', 'collaboration_22', {}, errorText);
    const id = `cf_${randomUUID()}`;
    try {
      await tx.$executeRaw`INSERT INTO custom_fields (id, "workspaceId", name, kind, options, position, "createdAt") VALUES (${id}, ${actor.workspaceId}, ${data.name}, ${data.kind}, ${options}::text[], ${count}, NOW())`;
    } catch (error) { if (isUnique(error)) throw duplicate(errorText); throw error; }
    await audit(tx, actor, 'publishing.custom_field_created', { fieldId: id, name: data.name, kind: data.kind, options });
    await lockActor(tx, actor, POSTS, true);
    return { id, name: data.name, kind: data.kind, options, position: count } satisfies CustomFieldRecord;
  }));
}

/** A malformed legacy relation must never let a workspace mutate another tenant's values. */
async function assertLocalFieldReferences(tx: Tx, workspaceId: string, fieldId: string) {
  const errorText = await loadPublishingErrorText();
  const rows = await tx.$queryRaw<Array<{ foreignReferences: boolean }>>`SELECT EXISTS (SELECT 1 FROM post_field_values v JOIN posts p ON p.id = v."postId" WHERE v."fieldId" = ${fieldId} AND p."workspaceId" <> ${workspaceId}) AS "foreignReferences"`;
  if (rows[0]?.foreignReferences !== false) throw new PublishingOperationError('conflict', 'collaboration_23', {}, errorText);
}

export async function updateCustomField(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(FIELD_UPDATE, input, undefined, errorText); exact(data.confirmation, updateFieldConfirmation(data.id), errorText);
  const limit = await bounds();
  const options = data.kind === 'choice' ? dedupeOptions(data.options) : [];
  if (options.length > limit.fieldOptionsLimit || data.name.length > limit.fieldNameMax || options.some(o => o.length > limit.fieldOptionMax)) throw bad(undefined, errorText);
  requireWorkspaceAdmin(await authorizePublishing(actor, POSTS, 'write'), errorText('actionCustomFields'), errorText);
  return protect(transact(actor.workspaceId, limit, async tx => {
    requireWorkspaceAdmin(await lockActor(tx, actor, POSTS, true), errorText('actionCustomFields'), errorText);
    const found = await tx.$queryRaw<Array<{ id: string; name: string; position: number }>>`SELECT id, name, position FROM custom_fields WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const before = found[0]; if (!before) throw missing(errorText);
    await assertLocalFieldReferences(tx, actor.workspaceId, data.id);
    if (data.kind === 'choice') {
      const stale = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_field_values WHERE "fieldId" = ${data.id} AND NOT (value = ANY(${options}::text[]))`;
      const n = Number(stale[0]?.count ?? 0);
      if (n > 0) throw new PublishingOperationError('conflict', n === 1 ? 'collaborationFieldOptionsSingle' : 'collaborationFieldOptionsMany', {value0: n}, errorText);
    }
    try {
      await tx.$executeRaw`UPDATE custom_fields SET name = ${data.name}, kind = ${data.kind}, options = ${options}::text[] WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId}`;
    } catch (error) { if (isUnique(error)) throw duplicate(errorText); throw error; }
    await audit(tx, actor, 'publishing.custom_field_updated', { fieldId: data.id, name: data.name, previousName: before.name, kind: data.kind, options });
    await lockActor(tx, actor, POSTS, true);
    return { id: data.id, name: data.name, kind: data.kind, options, position: before.position } satisfies CustomFieldRecord;
  }));
}

export async function deleteCustomField(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(FIELD_DELETE, input, undefined, errorText); exact(data.confirmation, deleteFieldConfirmation(data.id), errorText);
  const limit = await bounds();
  requireWorkspaceAdmin(await authorizePublishing(actor, POSTS, 'write'), errorText('actionCustomFields'), errorText);
  return protect(transact(actor.workspaceId, limit, async tx => {
    requireWorkspaceAdmin(await lockActor(tx, actor, POSTS, true), errorText('actionCustomFields'), errorText);
    const found = await tx.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM custom_fields WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const row = found[0]; if (!row) throw missing(errorText);
    await assertLocalFieldReferences(tx, actor.workspaceId, row.id);
    const used = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_field_values WHERE "fieldId" = ${row.id}`;
    const valuesRemoved = Number(used[0]?.count ?? 0);
    await tx.$executeRaw`DELETE FROM custom_fields WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'publishing.custom_field_deleted', { fieldId: row.id, name: row.name, valuesRemoved });
    await lockActor(tx, actor, POSTS, true);
    return { id: row.id, deleted: true as const, valuesRemoved };
  }));
}

/** Definitions plus the values one post currently holds. */
export async function readPostFieldValues(actor: PublishingActor, postId: unknown) {
  const errorText = await loadPublishingErrorText();
  const id = parse(ID, postId, undefined, errorText);
  const auth = await authorizePublishing(actor, POSTS, 'read');
  await visiblePost(prisma, auth, id);
  const [fields, values] = await protect(Promise.all([
    readCustomFields(actor),
    prisma.$queryRaw<Array<{ fieldId: string; value: string }>>`SELECT v."fieldId", v.value FROM post_field_values v JOIN custom_fields f ON f.id = v."fieldId" WHERE v."postId" = ${id} AND f."workspaceId" = ${actor.workspaceId}`,
  ]));
  const limit = await bounds();
  const byField = new Map(values.map(v => [v.fieldId, v.value]));
  return { postId: id, maxCharacters: limit.fieldValueMax, fields: fields.map(field => ({ ...field, value: byField.get(field.id) ?? '' })) };
}

/** Sets or clears (empty string) values for one post. Unknown fields and values outside a choice's options are refused. */
export async function setPostFieldValues(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(FIELD_VALUES, input, undefined, errorText); exact(data.confirmation, setFieldValuesConfirmation(data.postId), errorText);
  const limit = await bounds();
  const entries = Object.entries(data.values).map(([fieldId, value]) => [fieldId, value.trim()] as const);
  if (entries.length > limit.fieldLimit || entries.some(([, value]) => value.length > limit.fieldValueMax || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) throw bad(undefined, errorText);
  await authorizePublishing(actor, POSTS, 'write');
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, POSTS, true);
    const post = await visiblePost(tx, auth, data.postId, true);
    assertMayEdit(auth, post, errorText);
    const ids = entries.map(([fieldId]) => fieldId);
    const defs = ids.length ? await tx.$queryRaw<Array<{ id: string; kind: string; options: string[] }>>`SELECT id, kind::text AS kind, options FROM custom_fields WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${ids}::text[])` : [];
    if (defs.length !== ids.length) throw new PublishingOperationError('invalid_request', 'collaboration_25', {}, errorText);
    const kinds = new Map(defs.map(d => [d.id, d]));
    for (const [fieldId, value] of entries) {
      const def = kinds.get(fieldId)!;
      if (value && def.kind === 'choice' && !def.options.includes(value)) throw new PublishingOperationError('invalid_request', 'collaboration_26', {}, errorText);
    }
    let set = 0; let cleared = 0;
    for (const [fieldId, value] of entries) {
      if (!value) { cleared += await tx.$executeRaw`DELETE FROM post_field_values WHERE "postId" = ${data.postId} AND "fieldId" = ${fieldId}`; continue; }
      await tx.$executeRaw`INSERT INTO post_field_values (id, "postId", "fieldId", value) VALUES (${`pfv_${randomUUID()}`}, ${data.postId}, ${fieldId}, ${value}) ON CONFLICT ("postId", "fieldId") DO UPDATE SET value = EXCLUDED.value`;
      set += 1;
    }
    await audit(tx, actor, 'publishing.post_fields_changed', { postId: data.postId, fieldIds: ids, set, cleared });
    await lockActor(tx, actor, POSTS, true);
    return { postId: data.postId, set, cleared };
  }));
}
