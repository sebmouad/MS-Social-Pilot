import { ensurePublishingCollaboration } from '@/modules/publishing/server/collaboration';
import { handle, jsonBody } from '@/modules/publishing/collaboration/http';
import { readContentMix, saveContentMix, setContentMixAutoFill } from '@/modules/publishing/collaboration/server/content-mix';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { feature: 'publishing/queue', fallback: 'The content mix could not be loaded.', run: async actor => { ensurePublishingCollaboration(); return readContentMix(actor); } });
export const PUT = (request: Request) => handle(request, { feature: 'publishing/queue', write: true, fallback: 'The content mix could not be saved.', run: async actor => {
  ensurePublishingCollaboration();
  const input = await jsonBody(request);
  return input && typeof input === 'object' && !Array.isArray(input) && 'action' in input && (input as { action?: unknown }).action === 'setAutoFill'
    ? setContentMixAutoFill(actor, Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'action')))
    : saveContentMix(actor, input);
} });
