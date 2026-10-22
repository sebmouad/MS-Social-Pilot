import type { CaptionTestsCopy } from '../copy';
import { operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { configOrDefault } from '@/server/config/config-or-default';
import { runtimeConfig } from '@/server/config/store';
import { captionTestsCopySchema, captionTestsPolicySchema } from '../config';
import { learnCaptionTest, listCaptionTests, listTestablePosts, startCaptionTestInput, type Locale } from './service';


const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
const localeOf = (request: Request): Locale => request.headers.get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}

/** Authenticated REST entry for caption tests. The services own tenant checks, confirmations and audit. */
async function handle(request: Request, write: boolean, gate: { module: string; feature: string }, run: (actor: { userId: string; workspaceId: string }, body: unknown, locale: Locale) => Promise<unknown>) {
  const locale = localeOf(request);
  const copy = (await configOrDefault('captionTests.copy', captionTestsCopySchema))[locale] as CaptionTestsCopy;
  try {
    if (write && !sameOrigin(request)) return reply({ error: copy.errForbidden, code: 'forbidden' }, 403);
    // The entry gate only refuses early; every service repeats the full membership, grant and channel-scope check.
    const viewer = await requireViewer({ ...gate, channelScoped: true, ...(write ? { write: true } : {}) });
    let body: unknown;
    if (write) {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > captionTestsPolicySchema.parse(await runtimeConfig('captionTests.policy')).requestMaxBytes) return reply({ error: copy.errInvalid, code: 'invalid_request' }, 400);
      try { body = text ? JSON.parse(text) : {}; } catch { return reply({ error: copy.errInvalid, code: 'invalid_request' }, 400); }
    }
    return reply(await run({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, body, locale));
  } catch (error) { const f = operationFailure(error, copy.errUpstream); return reply({ error: f.error, code: f.code }, f.status); }
}

export const captionTestsListHttp = (request: Request) => handle(request, false, { module: 'analytics', feature: 'analytics/posts' }, (actor, _body, locale) =>
  new URL(request.url).searchParams.get('view') === 'posts' ? listTestablePosts(actor, { locale }).then(posts => ({ posts })) : listCaptionTests(actor, { locale }));
export const captionTestsStartHttp = (request: Request) => handle(request, true, { module: 'publishing', feature: 'publishing/posts' }, (actor, body, locale) => startCaptionTestInput(actor, body, { locale }));
export const captionTestLearnHttp = (request: Request, context: { params: Promise<{ id: string }> }) => handle(request, true, { module: 'settings', feature: 'settings/workspace' }, async (actor, body, locale) => {
  const { id } = await context.params;
  return learnCaptionTest(actor, { ...(body && typeof body === 'object' ? body : {}), id }, { locale });
});
