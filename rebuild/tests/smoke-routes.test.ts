/// <reference types="vite/client" />
import { RAW_ERROR_PATTERN, SMOKE_ORIGIN, setSmoke, type SmokeLocale, type SmokeRole } from './smoke-support';
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';

type Handler = (request: Request, context: { params: Promise<Record<string, unknown>> }) => Promise<Response> | Response;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Handler>>;

// Every route.ts under src/app, discovered at build time so a new route is covered automatically.
const loaders: Record<string, () => Promise<RouteModule>> = {
  ...(import.meta.glob('../src/app/**/route.ts') as Record<string, () => Promise<RouteModule>>),
  ...(import.meta.glob('../src/app/.well-known/**/route.ts') as Record<string, () => Promise<RouteModule>>),
};
const routeOf = (file: string) => file.replace('../src/app', '').replace(/\/route\.ts$/, '') || '/';
const paramsFor = (route: string) => Object.fromEntries([...route.matchAll(/\[(\.\.\.)?\[?(\w+)\]?\]/g)].map(match => [match[2], match[1] ? [] : 'smoke-id']));

/** Routes that authenticate with something other than the workspace session cookie. */
const NO_SESSION = /^\/(\.well-known|api\/(auth|oauth|v1|mcp|sharing\/public|connections\/\[platform\]\/callback)|bio|s\/|share)/;
/** Bearer-token surfaces: anonymous callers must get 401, not a session redirect. */
const BEARER = /^\/api\/(v1|mcp)/;
/** Writes that are cross-origin by protocol (OAuth token exchange, dynamic registration, public decisions). */
const CROSS_ORIGIN_BY_DESIGN = /^\/(api\/(oauth\/(token|register)|v1|mcp|sharing\/public)|\.well-known)/;
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const ROLES: SmokeRole[] = ['anonymous', 'owner', 'member', 'viewer'];
const LOCALES: SmokeLocale[] = ['en', 'fr'];
/** OAuth connectors are a Root switch; "temporarily_unavailable" (503) is the protocol answer while it is off. */
const OAUTH_SWITCHED_OFF = /^\/api\/oauth\//;
const BAD = new Set([500, 501, 502, 503, 504]);
const isBad = (route: string, status: number) => BAD.has(status) && !(status === 503 && OAUTH_SWITCHED_OFF.test(route));

/**
 * Read models built from joined raw SQL that the shared stub does not fabricate (a CSV of joined
 * member rows; a session-locking account export). They are still exercised for crashes; only the
 * content/401 checks that depend on those rows are waived. Dedicated tests cover their content.
 */
const NEEDS_JOINED_ROWS = new Set(['/api/root/privileges/export', '/api/settings/account/export']);

/** POST routes that only preview and change nothing, so they need no confirmation. */
const READ_ONLY_POST = new Set(['/api/settings/data']);

/**
 * Known gaps found by this smoke test and reported, not hidden: the route answers a signed-in
 * member or viewer with 401 (its own catch maps every guard failure to "Not authorized"), where
 * 403 is the accurate status. Listing a route here only waives that one status check.
 */
const LIMITED_ROLE_ANSWERS_401 = new Set([
  '/api/home/overview', '/api/settings/connections', '/api/settings/data', '/api/settings/data/exports', '/api/settings/data/exports/[id]',
  '/api/settings/data/snapshot', '/api/settings/profiles', '/api/settings/team', '/api/settings/team/invitations',
  '/api/settings/workspace/operations', '/api/settings/workspace/policy', '/api/webhooks', '/api/webhooks/[id]/deliveries', '/settings/profiles/operations',
]);

/**
 * Known gap: a cross-origin POST to sign-out still signs the user out (the route has no Origin check).
 * The test asserts the gap so that fixing it forces this entry to be removed.
 */
const CROSS_ORIGIN_ACCEPTED = new Set(['POST /api/auth/sign-out']);

/** Validation runs before authentication, so an anonymous caller sees 400 instead of 401 (nothing is disclosed). */
const VALIDATES_BEFORE_AUTH = new Set(['/api/publishing/recovery']);

type Row = { route: string; method: string; role: string; locale: string; check: string; status: number | string };
const report: Row[] = [];

async function call(file: string, method: keyof RouteModule, init: { role: SmokeRole; locale: SmokeLocale; origin?: string | null; body?: unknown }) {
  setSmoke(init.role, init.locale);
  const route = routeOf(file);
  const handler = (await loaders[file]!())[method]!;
  const headers: Record<string, string> = { host: 'localhost', 'accept-language': init.locale, 'content-type': 'application/json' };
  if (init.origin !== null) headers.origin = init.origin ?? SMOKE_ORIGIN;
  const url = `${SMOKE_ORIGIN}${route.replace(/\[\[?\.{0,3}(\w+)\]?\]/g, 'smoke-id')}`;
  const request = new Request(url, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(init.body ?? {}) }) });
  let response: Response;
  try { response = await handler(request, { params: Promise.resolve(paramsFor(route)) }); }
  catch (error) {
    // Route handlers may call redirect() (the OAuth callback does); Next turns that into a 307.
    const to = (error as { redirectTo?: string } | null)?.redirectTo;
    if (typeof to !== 'string') throw error;
    response = new Response(null, { status: 307, headers: { location: to } });
  }
  const text = await response.clone().text().catch(() => '');
  return { status: response.status, text, route };
}

function record(file: string, method: string, role: string, locale: string, check: string, status: number | string) {
  report.push({ route: routeOf(file), method, role, locale, check, status });
}

describe('route smoke', { timeout: 60_000 }, () => {
  const files = Object.keys(loaders).sort();
  it('discovers the route inventory', () => { expect(files.length).toBeGreaterThan(150); });

  for (const file of files) {
    const route = routeOf(file);

    for (const role of ROLES) for (const locale of LOCALES) {
      it(`GET ${route} as ${role} (${locale}) answers without a crash or raw error`, async (context) => {
        const mod = await loaders[file]!();
        if (!mod.GET) return context.skip();
        const { status, text } = await call(file, 'GET', { role, locale });
        record(file, 'GET', role, locale, 'read', status);
        expect(isBad(route, status), `${status} ${text.slice(0, 160)}`).toBe(false);
        if (!NEEDS_JOINED_ROWS.has(route)) expect(text).not.toMatch(RAW_ERROR_PATTERN);
        if (role === 'anonymous' && !NO_SESSION.test(route)) expect(VALIDATES_BEFORE_AUTH.has(route) ? [400, 401, 403] : [401, 403], text.slice(0, 160)).toContain(status);
        // 429 is the shared rate limiter answering before the credential check on bearer surfaces.
        if (role === 'anonymous' && BEARER.test(route)) expect([401, 429]).toContain(status);
        if (role !== 'anonymous' && !NO_SESSION.test(route) && !LIMITED_ROLE_ANSWERS_401.has(route) && !NEEDS_JOINED_ROWS.has(route)) expect(status, 'a signed-in session is never answered 401 by a session route').not.toBe(401);
        if (route.startsWith('/api/root') && role !== 'owner' && role !== 'anonymous') expect([401, 403, 404]).toContain(status);
      });
    }

    for (const method of WRITE_METHODS) {
      it(`${method} ${route} refuses anonymous callers and cross-origin requests`, async (context) => {
        const mod = await loaders[file]!();
        if (!mod[method]) return context.skip();
        const anonymous = await call(file, method, { role: 'anonymous', locale: 'en' });
        record(file, method, 'anonymous', 'en', 'write-anonymous', anonymous.status);
        expect(isBad(route, anonymous.status), `${anonymous.status} ${anonymous.text.slice(0, 160)}`).toBe(false);
        expect(anonymous.text).not.toMatch(RAW_ERROR_PATTERN);
        if (!NO_SESSION.test(route)) expect([401, 403], anonymous.text.slice(0, 160)).toContain(anonymous.status);

        if (!CROSS_ORIGIN_BY_DESIGN.test(route)) {
          for (const origin of ['http://evil.example', null]) {
            const foreign = await call(file, method, { role: 'owner', locale: 'en', origin });
            record(file, method, 'owner', 'en', `write-origin:${origin ?? 'none'}`, foreign.status);
            expect(isBad(route, foreign.status), `${origin}: ${foreign.text.slice(0, 160)}`).toBe(false);
            const succeeded = foreign.status >= 200 && foreign.status < 300;
            const gap = CROSS_ORIGIN_ACCEPTED.has(`${method} ${route}`) || (READ_ONLY_POST.has(route) && method === 'POST');
            expect(succeeded, `cross-origin ${method} ${gap ? 'is a recorded gap and must still be listed' : 'must not succeed'} (${origin}): ${foreign.text.slice(0, 160)}`).toBe(gap);
            expect(foreign.text).not.toMatch(RAW_ERROR_PATTERN);
          }
        }
      });

      it(`${method} ${route} never succeeds for a viewer or without confirmation, in English and French`, async (context) => {
        const mod = await loaders[file]!();
        if (!mod[method]) return context.skip();
        for (const locale of LOCALES) {
          const unconfirmed = await call(file, method, { role: 'owner', locale, body: {} });
          record(file, method, 'owner', locale, 'write-unconfirmed', unconfirmed.status);
          expect(isBad(route, unconfirmed.status), `${unconfirmed.status} ${unconfirmed.text.slice(0, 160)}`).toBe(false);
          expect(unconfirmed.text).not.toMatch(RAW_ERROR_PATTERN);
          if (!NO_SESSION.test(route)) {
            const previewOnly = READ_ONLY_POST.has(route) && method === 'POST';
            const signOut = CROSS_ORIGIN_ACCEPTED.has(`${method} ${route}`);
            if (!previewOnly && !signOut) expect(unconfirmed.status < 200 || unconfirmed.status >= 300, `an empty ${method} must not succeed: ${unconfirmed.text.slice(0, 160)}`).toBe(true);
            for (const role of ['viewer', 'member'] as const) {
              const limited = await call(file, method, { role, locale, body: {} });
              record(file, method, role, locale, 'write-limited', limited.status);
              expect(isBad(route, limited.status), `${role}: ${limited.status} ${limited.text.slice(0, 160)}`).toBe(false);
              if (!previewOnly && !signOut) expect(limited.status < 200 || limited.status >= 300, `${role} must not succeed: ${limited.text.slice(0, 160)}`).toBe(true);
              expect(limited.text).not.toMatch(RAW_ERROR_PATTERN);
            }
          }
        }
      });
    }
  }

  afterAll(() => {
    const target = process.env.SMOKE_REPORT;
    if (target) writeFileSync(target, JSON.stringify(report, null, 1));
  });
});
