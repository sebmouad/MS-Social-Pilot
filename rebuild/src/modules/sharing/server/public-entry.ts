import { clientIp } from '@/server/client-ip';
import { openPublicBio } from './bio';
import { resolvePublicLink } from './public';

/**
 * Entry routes for the public share and bio addresses.
 *
 * The app's root loading boundary streams every page response, so a page that calls notFound() has
 * already answered 200 by then. A route handler answers before anything streams: it decides here, and
 * only a link that resolves is handed on to the rendered page, which checks it again.
 */
const headers = { 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" };

type Kind = 'share' | 'bio';
const COPY = {
  en: {
    share: { missing: 'This link isn’t available', missingBody: 'It may have expired or been withdrawn. Ask the person who sent it for a new link.' },
    bio: { missing: 'This page isn’t available', missingBody: 'Check the address, or ask the person who shared it for the current link.' },
    busy: 'Too many visits just now', busyBody: 'Please wait a few minutes and try again.',
  },
  fr: {
    share: { missing: 'Ce lien n’est pas disponible', missingBody: 'Il a peut-être expiré ou été retiré. Demandez un nouveau lien à la personne qui vous l’a envoyé.' },
    bio: { missing: 'Cette page n’est pas disponible', missingBody: 'Vérifiez l’adresse ou demandez le lien actuel à la personne qui l’a partagé.' },
    busy: 'Trop de visites en ce moment', busyBody: 'Patientez quelques minutes puis réessayez.',
  },
} as const;

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
const localeOf = (request: Request) => /^\s*fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en';

function document(request: Request, status: number, title: string, body: string, extra: Record<string, string> = {}) {
  const lang = localeOf(request);
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)}</title><style>:root{color-scheme:light dark;--bg:#f5f7f4;--card:#fff;--ink:#18231e;--soft:#526159;--line:#dce4de}@media(prefers-color-scheme:dark){:root{--bg:#111a20;--card:#18242c;--ink:#edf4f6;--soft:#bdcbd1;--line:#344750}}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(100%,440px);padding:28px;border:1px solid var(--line);border-radius:16px;background:var(--card)}h1{margin:0 0 8px;font-size:22px;line-height:1.25}p{margin:0;color:var(--soft);line-height:1.55}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
  return new Response(request.method === 'HEAD' ? null : html, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', ...extra } });
}

export const publicNotFound = (request: Request, kind: Kind) => { const copy = COPY[localeOf(request)][kind]; return document(request, 404, copy.missing, copy.missingBody); };
export const publicRateLimited = (request: Request) => { const copy = COPY[localeOf(request)]; return document(request, 429, copy.busy, copy.busyBody, { 'Retry-After': '300' }); };

/** Hand a resolved visit on to the rendered page, keeping the query (portal tab). The token never leaves the path. */
function handOn(request: Request, path: string) {
  const target = new URL(path, request.url);
  target.search = new URL(request.url).search;
  return new Response(null, { status: 307, headers: { ...headers, Location: `${target.pathname}${target.search}` } });
}

export async function enterShare(request: Request, token: string): Promise<Response> {
  const view = `/share/${encodeURIComponent(token)}/view`;
  try {
    const access = await resolvePublicLink(token, clientIp(request));
    if (access.ok) return handOn(request, view);
    return access.reason === 'rate_limited' ? publicRateLimited(request) : publicNotFound(request, 'share');
  } catch {
    // The page shows its own retry notice; an outage is not evidence that the link is gone.
    return handOn(request, view);
  }
}

export async function enterBio(request: Request, slug: string): Promise<Response> {
  const view = `/bio/${encodeURIComponent(slug)}/view`;
  try {
    const access = await openPublicBio(slug, clientIp(request));
    if (access.ok) return handOn(request, view);
    return access.reason === 'rate_limited' ? publicRateLimited(request) : publicNotFound(request, 'bio');
  } catch {
    return handOn(request, view);
  }
}
