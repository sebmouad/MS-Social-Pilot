import { linkTools } from '@/modules/publishing/server/link-tools/service';
import { toolRoute } from '@/modules/ai/server/tool-kit';
import { toolErrorCopy } from '@/modules/ai/server/tool-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Thin entry: link preview, page details and picture import share the linkTools service. */
export const POST = (request: Request) => toolRoute(request, {
  module: 'publishing', feature: 'publishing/posts', errorCopy: toolErrorCopy,
  run: (actor, input, locale) => linkTools(actor, input, { locale }),
});
