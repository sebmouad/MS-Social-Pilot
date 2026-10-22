import { handle, jsonBody, query } from '@/modules/publishing/collaboration/http';
import { postVariants } from '@/modules/publishing/server/post-variants';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, {
  feature: 'publishing/posts', fallback: 'Language variants are unavailable. / Les variantes de langue sont indisponibles.',
  run: async actor => postVariants(actor, { action: 'list', postId: query(request, ['postId']).postId }),
});
export const POST = (request: Request) => handle(request, {
  feature: 'publishing/posts', write: true, fallback: 'Language variants are unavailable. / Les variantes de langue sont indisponibles.',
  run: async (actor, req) => postVariants(actor, await jsonBody(req)),
});
