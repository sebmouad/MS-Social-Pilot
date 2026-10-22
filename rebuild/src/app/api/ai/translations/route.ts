import { translatedPosts } from '@/modules/ai/server/translated/service';
import { toolRoute } from '@/modules/ai/server/tool-kit';
import { toolErrorCopy } from '@/modules/ai/server/tool-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Thin entry: suggestions are metered AI; creation goes through the Publishing lifecycle service per language. */
export const POST = (request: Request) => toolRoute(request, {
  module: 'publishing', feature: 'publishing/posts', errorCopy: toolErrorCopy,
  run: (actor, input, locale) => translatedPosts(actor, input, { locale }),
});
