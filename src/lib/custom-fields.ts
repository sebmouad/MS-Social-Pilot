import { z } from 'zod';

import { AppError, errors } from './errors';
import { prisma } from './prisma';

/**
 * Custom fields: the workspace adds a few fields to its posts (a campaign
 * code, a product, who asked for it) and fills them in when it writes one.
 * A `choice` field accepts only its listed options.
 */

export const FIELD_KINDS = ['text', 'choice'] as const;

export const customFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(FIELD_KINDS),
    options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  })
  .refine((field) => field.kind === 'text' || field.options.length >= 2, { message: 'A choice needs at least two options.' });

const duplicate = () => new AppError({ key: 'errors.fieldExists', fallback: 'A field with that name already exists.', status: 409 });

export async function listCustomFields(workspaceId: string) {
  return prisma.customField.findMany({ where: { workspaceId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
}

export async function createCustomField(workspaceId: string, raw: unknown) {
  const input = customFieldSchema.parse(raw);
  const position = await prisma.customField.count({ where: { workspaceId } });
  try {
    return await prisma.customField.create({
      data: { workspaceId, name: input.name, kind: input.kind, options: input.kind === 'choice' ? [...new Set(input.options)] : [], position },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw duplicate();
    throw error;
  }
}

export async function updateCustomField(workspaceId: string, id: string, raw: unknown) {
  const input = customFieldSchema.parse(raw);
  try {
    const { count } = await prisma.customField.updateMany({
      where: { id, workspaceId },
      data: { name: input.name, kind: input.kind, options: input.kind === 'choice' ? [...new Set(input.options)] : [] },
    });
    if (count === 0) throw errors.notFound();
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw duplicate();
    throw error;
  }
}

export async function deleteCustomField(workspaceId: string, id: string) {
  const { count } = await prisma.customField.deleteMany({ where: { id, workspaceId } });
  if (count === 0) throw errors.notFound();
}

/**
 * Set a post's values: a map of field id to value; an empty value clears it.
 * Fields from another workspace are ignored, and a choice outside its options
 * is refused.
 */
export async function setPostFields(workspaceId: string, postId: string, values: Record<string, string>) {
  const fields = await prisma.customField.findMany({ where: { workspaceId, id: { in: Object.keys(values) } } });
  for (const field of fields) {
    const value = (values[field.id] ?? '').trim();
    if (!value) {
      await prisma.postFieldValue.deleteMany({ where: { postId, fieldId: field.id } });
      continue;
    }
    if (field.kind === 'choice' && !field.options.includes(value)) {
      throw new AppError({ key: 'errors.fieldChoice', fallback: 'Pick one of the listed options.', status: 400 });
    }
    await prisma.postFieldValue.upsert({
      where: { postId_fieldId: { postId, fieldId: field.id } },
      create: { postId, fieldId: field.id, value: value.slice(0, 500) },
      update: { value: value.slice(0, 500) },
    });
  }
}

/** The values of a set of posts, by post id, as `{ name, value }` in field order. */
export async function readPostFields(workspaceId: string, postIds: string[]) {
  if (postIds.length === 0) return new Map<string, Array<{ fieldId: string; name: string; value: string }>>();
  const rows = await prisma.postFieldValue.findMany({
    where: { postId: { in: postIds }, field: { workspaceId } },
    include: { field: { select: { name: true, position: true } } },
    orderBy: { field: { position: 'asc' } },
  });
  const byPost = new Map<string, Array<{ fieldId: string; name: string; value: string }>>();
  for (const row of rows) byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), { fieldId: row.fieldId, name: row.field.name, value: row.value }]);
  return byPost;
}
