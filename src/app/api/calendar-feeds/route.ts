import { z } from 'zod';
import { getTranslations } from 'next-intl/server';

import { requireAuth } from '@/lib/auth';
import { createFeed, listFeeds } from '@/lib/calendar-feeds';
import { ok, readJson, route } from '@/lib/api';

/** Calendar feeds (H19): each member's own subscriptions. */
export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ feeds: await listFeeds(auth.workspace.id, auth.user.id) });
});

const createSchema = z.object({
  pageIds: z.array(z.string()).max(500).default([]),
  groupId: z.string().nullable().default(null),
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = createSchema.parse(await readJson(request));
  const t = await getTranslations('calendarFeed');
  const created = await createFeed({
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    pageScope: auth.pageScope,
    pageIds: input.pageIds,
    groupId: input.groupId,
    allName: t('allPagesName', { workspace: auth.workspace.name }),
  });
  return ok(created, 201);
});
