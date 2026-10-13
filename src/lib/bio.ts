import { z } from 'zod';

import { AppError } from './errors';
import { prisma } from './prisma';
import { httpUrl } from './validation';

/**
 * Link-in-bio: one public page per workspace, /bio/<slug>, with a few links.
 * Clicks go through our own redirect so each link's count is kept.
 */

export const bioSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Letters, digits and single dashes only.'),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullish(),
  avatarUrl: httpUrl.nullish(),
  enabled: z.boolean().default(true),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(80), url: httpUrl }))
    .max(30),
});
export type BioInput = z.infer<typeof bioSchema>;

export async function getBio(workspaceId: string) {
  return prisma.bioPage.findUnique({ where: { workspaceId }, include: { links: { orderBy: { position: 'asc' } } } });
}

export async function getBioBySlug(slug: string) {
  const page = await prisma.bioPage.findUnique({ where: { slug }, include: { links: { orderBy: { position: 'asc' } } } });
  return page?.enabled ? page : null;
}

export async function saveBio(workspaceId: string, input: BioInput) {
  const taken = await prisma.bioPage.findUnique({ where: { slug: input.slug }, select: { workspaceId: true } });
  if (taken && taken.workspaceId !== workspaceId) {
    throw new AppError({ key: 'errors.bioSlugTaken', fallback: 'That address is taken. Choose another.', status: 409 });
  }
  const data = { slug: input.slug, title: input.title, description: input.description ?? null, avatarUrl: input.avatarUrl ?? null, enabled: input.enabled };
  return prisma.$transaction(async (tx) => {
    const page = await tx.bioPage.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
    // Keep a link's count when its label and address are unchanged.
    const before = await tx.bioLink.findMany({ where: { pageId: page.id } });
    const counts = new Map(before.map((link) => [`${link.label}\n${link.url}`, link.clicks]));
    await tx.bioLink.deleteMany({ where: { pageId: page.id } });
    await tx.bioLink.createMany({
      data: input.links.map((link, position) => ({ pageId: page.id, label: link.label, url: link.url, position, clicks: counts.get(`${link.label}\n${link.url}`) ?? 0 })),
    });
    return page;
  });
}

/** Count a click and answer where it goes; null when the link is not on a live page. */
export async function followBioLink(slug: string, linkId: string): Promise<string | null> {
  const link = await prisma.bioLink.findFirst({ where: { id: linkId, page: { slug, enabled: true } }, select: { id: true, url: true } });
  if (!link) return null;
  await prisma.bioLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } });
  return link.url;
}
