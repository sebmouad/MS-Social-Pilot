import { captionTests } from '@/modules/publishing/server/caption-tests/service';
import { toolRoute, singleParams } from '@/modules/ai/server/tool-kit';
import { toolErrorCopy } from '@/modules/ai/server/tool-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Thin entry: GET ?action=list or ?action=get&id=…; POST creates a test or saves its learning. */
const handle = (request: Request) => toolRoute(request, {
  module: 'publishing', feature: 'publishing/posts', errorCopy: toolErrorCopy,
  query: params => { const q = singleParams(params, ['action', 'id']); return { action: q.action ?? 'list', ...(q.id ? { id: q.id } : {}) }; },
  run: (actor, input, locale) => captionTests(actor, input, { locale }),
});
export const GET = handle;
export const POST = handle;
