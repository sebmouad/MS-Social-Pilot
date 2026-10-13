/**
 * The public product site: home, pricing, help, status and
 * changelog for visitors who are not signed in. Off until root switches it on,
 * so an installation used privately still opens on the sign-in form.
 */
import { z } from 'zod';

import { prisma } from './prisma';
import { ensureSettings, settingBoolean } from './settings';

export async function siteIsPublic(): Promise<boolean> {
  await ensureSettings();
  return settingBoolean('site.public');
}

export const changelogSchema = z.object({
  publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(5000).default(''),
});

export function listChangelog(limit = 100) {
  return prisma.changelogEntry.findMany({ orderBy: [{ publishedOn: 'desc' }, { createdAt: 'desc' }], take: limit });
}

export function addChangelogEntry(input: z.infer<typeof changelogSchema>) {
  return prisma.changelogEntry.create({
    data: { publishedOn: new Date(`${input.publishedOn}T00:00:00Z`), title: input.title, body: input.body },
  });
}

export async function deleteChangelogEntry(id: string): Promise<boolean> {
  return (await prisma.changelogEntry.deleteMany({ where: { id } })).count > 0;
}
