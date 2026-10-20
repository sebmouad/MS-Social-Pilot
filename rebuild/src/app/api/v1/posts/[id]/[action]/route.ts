import { handleKey } from '@/modules/integrations/http';
import { REST_POSTS_FEATURE, readCappedJson } from '@/modules/integrations/server/rest';
import { keyPostAction } from '@/modules/publishing/server/api-actions';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; action: string }> };
/**
 * Scheduling actions for a post, key-authenticated: `schedule`, `reschedule`, `cancel-schedule`, `queue`. Same Publishing services and
 * exact confirmations as the app and MCP (e.g. `SCHEDULE POST {id} {scheduledAt}`). Needs the posts write grant; the key's channel ceiling applies.
 */
export const POST = async (request: Request, context: Context) => {
  const { id, action } = await context.params;
  return handleKey(request, { need: { feature: REST_POSTS_FEATURE, write: true }, fallback: 'The change could not be confirmed. Check the post before trying again.', run: async ctx => keyPostAction(ctx.viewer, id, action, await readCappedJson(request)) });
};
