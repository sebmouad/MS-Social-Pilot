import { listShareableChannels } from '@/modules/sharing/server/links';
import { failure, ownerActor, reply, withSharingErrors } from '../_http';
export const dynamic = 'force-dynamic';
export const GET = withSharingErrors(async (request: Request) => {
  if (request.headers.has('authorization') || request.headers.has('x-api-key')) return reply({ error: 'Use a signed-in browser session.', code: 'forbidden' }, 403);
  const actor = await ownerActor('sharing', false);
  if (!actor) return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
  if ([...new URL(request.url).searchParams].length) return reply({ error: 'This action takes no filters.', code: 'invalid_request' }, 400);
  try { return reply({ channels: await listShareableChannels(actor) }); }
  catch (error) { return failure(error, 'Channels could not be loaded.'); }
});
