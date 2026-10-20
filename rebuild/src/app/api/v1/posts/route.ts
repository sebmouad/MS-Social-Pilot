import { handleKey, query } from '@/modules/integrations/http';
import { REST_POSTS_FEATURE, REST_POSTS_QUERY_KEYS, readCappedJson, restListPosts } from '@/modules/integrations/server/rest';
import { keyCreatePost } from '@/modules/publishing/server/api-actions';
export const dynamic = 'force-dynamic';
/** Posts the key may see, newest first. `?status=scheduled&from=…&to=…&limit=50&channelId=…&q=…`. Needs the Publishing posts read grant. */
export const GET = (request: Request) => handleKey(request, { need: { feature: REST_POSTS_FEATURE }, fallback: 'The request could not be completed.', run: ctx => restListPosts(ctx, query(request, REST_POSTS_QUERY_KEYS)) });
/**
 * Create a draft, or schedule with `scheduledAt` (optionally `scheduleMode` and per-destination `destinationScheduleModes`: "application" or
 * "remote"). Same Publishing rules as the app and MCP; a workspace that needs approval holds the post. Needs the posts write grant.
 */
export const POST = (request: Request) => handleKey(request, { need: { feature: REST_POSTS_FEATURE, write: true }, success: 201, fallback: 'The post could not be created. Check Posts before trying again.', run: async ctx => keyCreatePost(ctx.viewer, await readCappedJson(request)) });
