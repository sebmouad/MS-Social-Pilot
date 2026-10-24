import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { requestOrigin } from '@/server/request-origin';
import { scheduledAgents } from './scheduled';
import { agentCopy } from './copy';
/** Authenticated, same-origin REST entry; all domain decisions remain in scheduledAgents. */
export async function scheduledAgentsHttp(request: Request) {
 const locale = request.headers.get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
 const copy = await agentCopy(locale);
 const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
 try {
  if (request.method !== 'GET') {
   const origin = request.headers.get('origin');
   if (!origin || new URL(origin).origin !== requestOrigin(request)) return reply({ error: copy.forbidden, code: 'forbidden' }, 403);
  }
  const viewer = await requireViewer({ module: 'studio', feature: 'studio/agents', channelScoped: true });
  const query = new URL(request.url).searchParams;
  let input: unknown;
  if (request.method === 'GET') {
   if (query.size) return reply({ error: copy.invalid_request, code: 'invalid_request' }, 400);
   input = { action: 'list' };
  } else {
   if (query.size) return reply({ error: copy.invalid_request, code: 'invalid_request' }, 400);
   try { input = await request.json(); } catch { return reply({ error: copy.invalid_request, code: 'invalid_request' }, 400); }
  }
  return reply(await scheduledAgents({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input, { locale }));
 } catch (error) { const failure = operationFailure(error, copy.upstream_failure); return reply({ error: copy[failure.code], code: failure.code }, failure.status); }
}
