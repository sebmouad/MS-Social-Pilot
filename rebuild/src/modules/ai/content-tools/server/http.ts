import { operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { aiMediaStatus, generateImage, generateVoice, listVideos, startVideo, type MediaActor } from './media';
import { engagementOutlook, linkPreview, spamCheck } from './checks';
import { toolsCopy, localeOf, type Locale } from './copy-loader';

/** Largest request body any of these entry points reads; field limits are enforced by the services from Root policy. */
const MAX_BODY_BYTES = 200_000;
const noStore = { 'cache-control': 'private, no-store' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}

/**
 * One authenticated, same-origin REST wrapper for the composer tools. Entry-point gating only refuses early:
 * every service repeats the full membership, entitlement, grant and channel-scope check.
 */
async function handle(request: Request, write: boolean, run: (actor: MediaActor, body: unknown, locale: Locale) => Promise<Response | unknown>) {
  const locale = localeOf(request);
  const copy = await toolsCopy(locale);
  try {
    if (write && !sameOrigin(request)) return reply({ error: copy.errForbidden, code: 'forbidden' }, 403);
    const viewer = await requireViewer({ module: 'publishing', feature: 'publishing/posts', channelScoped: true, ...(write ? { write: true } : {}) });
    const actor: MediaActor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    let body: unknown;
    if (request.method === 'POST') {
      const declared = Number(request.headers.get('content-length') ?? '0');
      const text = Number.isFinite(declared) && declared > MAX_BODY_BYTES ? null : await request.text();
      if (text === null || text.length > MAX_BODY_BYTES) return reply({ error: copy.errInvalid, code: 'invalid_request' }, 400);
      try { body = JSON.parse(text); } catch { return reply({ error: copy.errInvalid, code: 'invalid_request' }, 400); }
    }
    const result = await run(actor, body, locale);
    return result instanceof Response ? result : reply(result);
  } catch (error) { const f = operationFailure(error, copy.errUpstream); return reply({ error: f.error, code: f.code }, f.status); }
}

export const aiMediaStatusHttp = (request: Request) => handle(request, false, (actor, _body, locale) => aiMediaStatus(actor, { locale }));
export const aiImageHttp = (request: Request) => handle(request, true, async (actor, body, locale) => generateImage(actor, body, { locale }));
export const aiVoiceHttp = (request: Request) => handle(request, true, async (actor, body, locale) => {
  const voice = await generateVoice(actor, body, { locale });
  return new Response(new Uint8Array(voice.audio), { headers: { 'content-type': voice.mimeType, 'content-length': String(voice.bytes), ...noStore } });
});
export const aiVideoHttp = (request: Request) => handle(request, request.method === 'POST', (actor, body, locale) => request.method === 'POST' ? startVideo(actor, body, { locale }) : listVideos(actor, { locale }));
export const linkPreviewHttp = (request: Request) => handle(request, true, (actor, body, locale) => linkPreview(actor, body, { locale }));
export const outlookHttp = (request: Request) => handle(request, true, (actor, body, locale) => engagementOutlook(actor, body, { locale }));
export const spamCheckHttp = (request: Request) => handle(request, true, (actor, body, locale) => spamCheck(actor, body, { locale }));
