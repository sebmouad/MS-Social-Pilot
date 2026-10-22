import { aiStatus, runAssist } from '@/modules/ai/server/ai';
import { failure, readJson, reply, sameOrigin, viewerActor } from '@/modules/media/server/http';
export const dynamic = 'force-dynamic';

export async function GET() {
  const actor = await viewerActor('publishing/posts', false); if (actor instanceof Response) return actor;
  try { return reply(await aiStatus(actor)); } catch (error) { return failure(error, 'AI assist status could not be loaded.'); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await viewerActor('publishing/posts', true); if (actor instanceof Response) return actor;
  try { return reply(await runAssist(actor, await readJson(request, 'Enter the text and options for AI assist.'))); }
  catch (error) { return failure(error, 'AI assist could not complete this request.'); }
}
