/**
 * Shared harness for the route and action smoke tests (tests/smoke-*.test.ts).
 *
 * It replaces the Prisma client with a stub that behaves like an empty database
 * for the signed-in user, so every page and route runs its real guards and
 * services against synthetic fixtures. Import this file FIRST in a smoke test:
 * its `vi.mock` calls must register before any application module loads.
 */
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SmokeRole = 'anonymous' | 'owner' | 'member' | 'viewer';
export type SmokeLocale = 'en' | 'fr';

const smoke = vi.hoisted(() => ({
  role: 'owner' as 'anonymous' | 'owner' | 'member' | 'viewer',
  locale: 'en' as 'en' | 'fr',
  headers: {} as Record<string, string>,
  rawCalls: [] as string[],
}));

export const SMOKE_USER = { id: 'smoke-user', name: 'Smoke User', email: 'smoke@example.test' };
export const SMOKE_WORKSPACE = { id: 'smoke-workspace', name: 'Smoke Workspace', slug: 'smoke', timezone: 'Europe/Paris' };
export const SMOKE_ORIGIN = 'http://localhost';

const ROLE_ROW = { owner: 'owner', member: 'editor', viewer: 'viewer', anonymous: 'viewer' } as const;

function sqlText(args: unknown[]): string {
  const first = args[0];
  return Array.isArray(first) ? first.join('?') : typeof first === 'string' ? first : '';
}

function rawQuery(args: unknown[]): unknown[] {
  const text = sqlText(args);
  smoke.rawCalls.push(text.slice(0, 80));
  if (text.includes('member_page_access')) {
    return [{ role: ROLE_ROW[smoke.role], allPages: smoke.role === 'owner', workspaceDisabled: [], memberDisabled: [], clientAccess: [], pageIds: [] }];
  }
  if (text.includes('"isInstanceOwner"') && text.includes('FROM memberships m')) {
    return [{ workspaceId: SMOKE_WORKSPACE.id, workspaceDisabled: [], suspendedAt: null, memberDisabled: [], planFeatures: null, isInstanceOwner: smoke.role === 'owner' }];
  }
  if (smoke.role === 'anonymous') return [];
  if (/FROM users WHERE (id|u\.id)\b|SELECT theme FROM users/.test(text)) return [{ id: SMOKE_USER.id, theme: 'vivid', disabledAt: null, isInstanceOwner: smoke.role === 'owner' }];
  if (/SELECT m\.role::text AS role/.test(text)) {
    return [{ role: ROLE_ROW[smoke.role], suspendedAt: null, allPages: smoke.role === 'owner', memberDisabled: [], workspaceDisabled: [], clientAccess: [] }];
  }
  return [];
}

const SMOKE_SETTINGS: Record<string, unknown> = { 'storage.mediaRoot': mkdtempSync(join(tmpdir(), 'smoke-media-')) };

const SCALAR_DEFAULTS: Record<string, unknown> = {
  count: 0, findMany: [], findFirst: null, findUnique: null, findFirstOrThrow: null, findUniqueOrThrow: null,
  aggregate: {}, groupBy: [], create: {}, createMany: { count: 0 }, update: {}, updateMany: { count: 0 }, upsert: {}, delete: {}, deleteMany: { count: 0 },
};

function modelStub(model: string): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return new Proxy({}, {
    get: (_t, method: string) => async (arg?: { where?: Record<string, unknown> }) => {
      if (smoke.role !== 'anonymous') {
        if (model === 'session' && method === 'findUnique') {
          return { id: 'smoke-session', userId: SMOKE_USER.id, tokenHash: arg?.where?.tokenHash, expiresAt: new Date(Date.now() + 3_600_000), pending: null, user: { id: SMOKE_USER.id, disabledAt: null } };
        }
        if (model === 'user' && (method === 'findUnique' || method === 'findFirst')) {
          return { ...SMOKE_USER, isInstanceOwner: smoke.role === 'owner', disabledAt: null, locale: smoke.locale };
        }
        if (model === 'membership' && method === 'findMany') {
          return [{ id: 'smoke-membership', role: ROLE_ROW[smoke.role], userId: SMOKE_USER.id, workspaceId: SMOKE_WORKSPACE.id, allPages: true, workspace: SMOKE_WORKSPACE, user: { ...SMOKE_USER, isInstanceOwner: smoke.role === 'owner', disabledAt: null } }];
        }
        if (model === 'membership' && (method === 'findFirst' || method === 'findUnique')) {
          return { id: 'smoke-membership', userId: SMOKE_USER.id, workspaceId: SMOKE_WORKSPACE.id, role: ROLE_ROW[smoke.role], allPages: smoke.role === 'owner', workspace: SMOKE_WORKSPACE };
        }
        if (model === 'workspace' && (method === 'findUnique' || method === 'findFirst')) return { ...SMOKE_WORKSPACE, suspendedAt: null };
      }
      // Installation settings that a configured preview would have; everything else falls back to registry defaults.
      if (model === 'appSetting' && method === 'findUnique') {
        const key = String(arg?.where?.key);
        return key in SMOKE_SETTINGS ? { value: SMOKE_SETTINGS[key], encrypted: false } : null;
      }
      if (model === 'appSetting' && method === 'findMany') {
        const keys = ((arg?.where as { key?: { in?: string[] } } | undefined)?.key?.in ?? []).filter(key => key in SMOKE_SETTINGS);
        return keys.map(key => ({ key, value: SMOKE_SETTINGS[key], encrypted: false }));
      }
      const value = SCALAR_DEFAULTS[method];
      return value === undefined ? null : Array.isArray(value) ? [] : value && typeof value === 'object' ? { ...value } : value;
    },
  });
}

class StubPrismaClient {
  constructor() {
    const models = new Map<string, unknown>();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self: unknown = new Proxy(this, {
      get: (target, prop: string | symbol) => {
        if (typeof prop === 'symbol') return undefined;
        if (prop === '$queryRaw' || prop === '$queryRawUnsafe') return async (...args: unknown[]) => rawQuery(args);
        if (prop === '$executeRaw' || prop === '$executeRawUnsafe') return async () => 0;
        if (prop === '$transaction') return async (work: unknown) => (typeof work === 'function' ? (work as (tx: unknown) => unknown)(self) : Promise.all(work as Promise<unknown>[]));
        if (prop === '$connect' || prop === '$disconnect') return async () => undefined;
        if (prop === 'then') return undefined;
        if (prop in target) return (target as never)[prop];
        if (!models.has(prop)) models.set(prop, modelStub(prop));
        return models.get(prop);
      },
    });
    return self as StubPrismaClient;
  }
}

vi.mock('../generated/client', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), PrismaClient: StubPrismaClient }));

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => {
  const cookieJar = () => ({
    get: (name: string) => (smoke.role !== 'anonymous' && name === 'msp_session' ? { name, value: Buffer.alloc(32, 7).toString('base64url') } : undefined),
    getAll: () => [], has: () => false, set: () => undefined, delete: () => undefined, toString: () => '',
  });
  const headerJar = () => {
    const map = new Map<string, string>([['accept-language', smoke.locale], ['host', 'localhost'], ['x-forwarded-proto', 'http'], ...Object.entries(smoke.headers)]);
    return { get: (name: string) => map.get(name.toLowerCase()) ?? null, has: (name: string) => map.has(name.toLowerCase()), entries: () => map.entries(), forEach: (fn: (v: string, k: string) => void) => map.forEach(fn), [Symbol.iterator]: () => map.entries() };
  };
  return { cookies: async () => cookieJar(), headers: async () => headerJar() };
});

vi.mock('next/navigation', () => {
  const redirect = (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;`, redirectTo: to }); };
  const notFound = () => { throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }); };
  return {
    redirect, permanentRedirect: redirect, notFound,
    usePathname: () => '/', useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, prefetch: () => undefined }),
    useSearchParams: () => new URLSearchParams(), useParams: () => ({}), useSelectedLayoutSegment: () => null, useSelectedLayoutSegments: () => [],
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T,>(fn: T) => fn, unstable_noStore: () => undefined, cacheLife: () => undefined, cacheTag: () => undefined,
}));

export function setSmoke(role: SmokeRole, locale: SmokeLocale = 'en', headers: Record<string, string> = {}) {
  smoke.role = role; smoke.locale = locale; smoke.headers = headers;
}

export const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function isRedirect(error: unknown): string | null {
  const to = (error as { redirectTo?: string } | null)?.redirectTo;
  return typeof to === 'string' ? to : null;
}
export const isNotFound = (error: unknown) => (error as { digest?: string } | null)?.digest === 'NEXT_HTTP_ERROR_FALLBACK;404';

/** Text that must never reach a customer or an API client. */
export const RAW_ERROR_PATTERN = /PrismaClient|PrismaClientKnownRequestError|Invalid `prisma|ECONNREFUSED|stack trace|TypeError|ReferenceError|Cannot read prop|is not a function|\[object Object\]|\bat (?:async )?[\w.<>]+ \(.*:\d+:\d+\)|node_modules|P20\d\d\b|\bundefined\b|\bNaN\b/;
