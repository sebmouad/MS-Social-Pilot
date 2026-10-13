import { requireRootApi } from '@/lib/auth';
import { ok, readJson, route } from '@/lib/api';
import { logRootActivity } from '@/lib/root';
import { addChangelogEntry, changelogSchema } from '@/lib/site';

/** Root adds an entry to the public changelog. */
export const POST = route(async (request: Request) => {
  const auth = await requireRootApi();
  const entry = await addChangelogEntry(changelogSchema.parse(await readJson(request)));
  await logRootActivity(auth.user.id, 'changelog.added', { title: entry.title });
  return ok({ entry });
});
