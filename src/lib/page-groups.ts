import { z } from 'zod';

import { prisma } from './prisma';
import { AppError } from './errors';
import { targetScope, type PageScope } from './page-access';
import { PALETTE_KEYS, type PaletteKey } from './palette';

export { PALETTE, PALETTE_KEYS, paletteOf, type PaletteKey } from './palette';

/**
 * Page groups and post labels: two named, coloured sets.
 *
 * A group is a set of Pages — a client, a brand, a country — that can be
 * ticked in the composer in one click and used to filter the calendar, the
 * queue, the post list and the reports. A label is a set of posts — a
 * campaign, a theme — for the same filtering on the content side.
 *
 * They share one colour palette so a chip reads the same everywhere.
 */

const name = z.string().trim().min(1).max(40);
const color = z.enum(PALETTE_KEYS as [PaletteKey, ...PaletteKey[]]);

export const pageGroupSchema = z.object({
  name,
  color: color.default('blue'),
  targetIds: z.array(z.string().min(1)).max(500).default([]),
});

export const pageGroupUpdateSchema = pageGroupSchema.partial();

export const labelSchema = z.object({ name, color: color.default('blue') });
export const labelUpdateSchema = labelSchema.partial();

export interface PageGroupView {
  id: string;
  name: string;
  color: PaletteKey;
  targetIds: string[];
}

export interface LabelView {
  id: string;
  name: string;
  color: PaletteKey;
}

/**
 * The workspace's groups, each listing only the Pages this member may see.
 * A group whose Pages are all outside their access still shows, empty — its
 * name is not a secret, and hiding it would make the list differ per person
 * in a way nobody could explain.
 */
export async function listPageGroups(workspaceId: string, scope: PageScope): Promise<PageGroupView[]> {
  const groups = await prisma.pageGroup.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' },
    include: { pages: { where: { target: targetScope(scope) }, select: { targetId: true } } },
  });
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    color: paletteKey(group.color),
    targetIds: group.pages.map((page) => page.targetId),
  }));
}

export async function listLabels(workspaceId: string): Promise<LabelView[]> {
  const labels = await prisma.label.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
  return labels.map((label) => ({ id: label.id, name: label.name, color: paletteKey(label.color) }));
}

function paletteKey(value: string): PaletteKey {
  return (PALETTE_KEYS as string[]).includes(value) ? (value as PaletteKey) : 'blue';
}

/** Keep only ids that are Pages of this workspace. */
async function ownTargets(workspaceId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.target.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

const duplicateName = () =>
  new AppError({ key: 'errors.nameTaken', fallback: 'That name is already used.', status: 409 });

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

export async function createPageGroup(
  workspaceId: string,
  input: z.infer<typeof pageGroupSchema>,
): Promise<PageGroupView> {
  const targetIds = await ownTargets(workspaceId, input.targetIds);
  try {
    const group = await prisma.pageGroup.create({
      data: {
        workspaceId,
        name: input.name,
        color: input.color,
        pages: { create: targetIds.map((targetId) => ({ targetId })) },
      },
    });
    return { id: group.id, name: group.name, color: paletteKey(group.color), targetIds };
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

export async function updatePageGroup(
  workspaceId: string,
  id: string,
  input: z.infer<typeof pageGroupUpdateSchema>,
): Promise<boolean> {
  const group = await prisma.pageGroup.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!group) return false;
  const targetIds = input.targetIds ? await ownTargets(workspaceId, input.targetIds) : null;
  try {
    await prisma.$transaction([
      prisma.pageGroup.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        },
      }),
      ...(targetIds
        ? [
            prisma.pageGroupTarget.deleteMany({ where: { groupId: id } }),
            prisma.pageGroupTarget.createMany({ data: targetIds.map((targetId) => ({ groupId: id, targetId })) }),
          ]
        : []),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
  return true;
}

export async function deletePageGroup(workspaceId: string, id: string): Promise<boolean> {
  const { count } = await prisma.pageGroup.deleteMany({ where: { id, workspaceId } });
  return count > 0;
}

export async function createLabel(workspaceId: string, input: z.infer<typeof labelSchema>): Promise<LabelView> {
  try {
    const label = await prisma.label.create({ data: { workspaceId, name: input.name, color: input.color } });
    return { id: label.id, name: label.name, color: paletteKey(label.color) };
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

export async function updateLabel(
  workspaceId: string,
  id: string,
  input: z.infer<typeof labelUpdateSchema>,
): Promise<boolean> {
  try {
    const { count } = await prisma.label.updateMany({ where: { id, workspaceId }, data: input });
    return count > 0;
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

export async function deleteLabel(workspaceId: string, id: string): Promise<boolean> {
  const { count } = await prisma.label.deleteMany({ where: { id, workspaceId } });
  return count > 0;
}

/** Keep only label ids that belong to this workspace. */
export async function ownLabels(workspaceId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.label.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * The Pages a screen should show, from its `pages` and `group` parameters.
 *
 * `group` picks a group's Pages; `pages` is a comma list of the Pages left
 * visible with the eye toggles. Both are narrowed to the member's access, and
 * an id that is not one of theirs is dropped rather than refused — a link
 * shared by a colleague with more access should still open.
 *
 * Returns null when nothing narrows the view, so the caller can skip the
 * filter entirely.
 */
export function visiblePages(options: {
  allIds: string[];
  groups: PageGroupView[];
  group?: string | null;
  pages?: string | null;
}): string[] | null {
  const { allIds } = options;
  let ids: string[] | null = null;
  if (options.group) {
    const group = options.groups.find((entry) => entry.id === options.group);
    if (group) ids = group.targetIds.filter((id) => allIds.includes(id));
  }
  if (options.pages !== undefined && options.pages !== null) {
    const listed = options.pages
      .split(',')
      .map((id) => id.trim())
      .filter((id) => allIds.includes(id));
    ids = ids ? ids.filter((id) => listed.includes(id)) : listed;
  }
  return ids;
}
