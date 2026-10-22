import { handle, jsonBody } from '@/modules/publishing/collaboration/http';
import { queuePostRequest } from '@/modules/publishing/server/queue';
import { workspaceTimeLabels } from '@/modules/publishing/server/display-time';
export const dynamic = 'force-dynamic';

export const POST = (request: Request) => handle(request, {
  feature: 'publishing/queue', write: true, fallback: 'The post could not be added to the queue.',
  run: async actor => {
    const result = await queuePostRequest(actor, await jsonBody(request));
    // Preformatted on the server: browsers can disagree with Node about a workspace zone's offset.
    return { ...result, scheduledLabel: (await workspaceTimeLabels(actor.workspaceId)).full(result.scheduledAt) };
  },
});
