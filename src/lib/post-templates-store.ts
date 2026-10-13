import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { AppError, errors } from './errors';
import { normaliseHashtags, TEMPLATE_LIMITS } from './post-templates';
import { prisma } from './prisma';

/** Post templates: saving and listing, workspace by workspace. */

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_LIMITS.name),
  category: z.string().trim().max(TEMPLATE_LIMITS.category).default(''),
  body: z.string().trim().min(1).max(TEMPLATE_LIMITS.body),
  hashtags: z.string().max(TEMPLATE_LIMITS.hashtags).default('').transform(normaliseHashtags),
  firstComment: z.string().trim().max(TEMPLATE_LIMITS.firstComment).default(''),
  labelId: z.string().min(1).nullable().default(null),
});

export type TemplateInput = z.infer<typeof templateSchema>;

export const TEMPLATE_SELECT = {
  id: true,
  name: true,
  category: true,
  body: true,
  hashtags: true,
  firstComment: true,
  labelId: true,
} as const;

export function listTemplates(workspaceId: string) {
  return prisma.postTemplate.findMany({
    where: { workspaceId },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: TEMPLATE_SELECT,
  });
}

function nameTaken(): AppError {
  return new AppError({ key: 'errors.templateNameTaken', fallback: 'A template with this name already exists.', status: 409 });
}

async function checkLabel(workspaceId: string, labelId: string | null | undefined): Promise<void> {
  if (!labelId) return;
  const label = await prisma.label.findFirst({ where: { id: labelId, workspaceId }, select: { id: true } });
  if (!label) throw errors.notFound();
}

function duplicate(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createTemplate(workspaceId: string, input: TemplateInput) {
  await checkLabel(workspaceId, input.labelId);
  try {
    return await prisma.postTemplate.create({ data: { workspaceId, ...input }, select: TEMPLATE_SELECT });
  } catch (error) {
    if (duplicate(error)) throw nameTaken();
    throw error;
  }
}

export async function updateTemplate(workspaceId: string, id: string, input: TemplateInput) {
  await checkLabel(workspaceId, input.labelId);
  try {
    const { count } = await prisma.postTemplate.updateMany({ where: { id, workspaceId }, data: input });
    if (count === 0) throw errors.notFound();
  } catch (error) {
    if (duplicate(error)) throw nameTaken();
    throw error;
  }
}
