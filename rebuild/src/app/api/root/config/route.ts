import { readRootConfig, saveRootConfig } from '@/modules/root/server/configuration';
import { rootRoute, readBody, searchParamsObject } from '@/server/root/legacy/http';
export const runtime = 'nodejs';
export const GET = rootRoute({}, async (request, actorId) => {
  searchParamsObject(request);
  return readRootConfig(actorId);
});
export const PUT = rootRoute({ write: true }, async (request, actorId) => {
  await saveRootConfig(await readBody(request), actorId);
  return readRootConfig(actorId);
});
