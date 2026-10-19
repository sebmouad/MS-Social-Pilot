import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const tx = { session: { findUnique: vi.fn(), deleteMany: vi.fn() }, user: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn() };
  return {
    tx,
    prisma: { user: { findUnique: vi.fn() }, session: { findMany: vi.fn() }, socialAccount: { count: vi.fn(), findMany: vi.fn() } },
    actor: vi.fn(),
  };
});
vi.mock('../src/server/data', () => ({ prisma: h.prisma }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: h.actor }));
vi.mock('../src/server/root/legacy/policy', () => ({
  legacySetting: vi.fn(async (key: string) => (key === 'root.legacy.searchMaxCharacters' ? 50 : 2)),
  rootResultLimit: (configured: number, requested?: number) => (requested === undefined ? configured : Math.min(configured, requested)),
  rootTransaction: (fn: (tx: unknown) => unknown) => fn(h.tx),
}));

import { listRootSessions, signOutRootSession } from '../src/server/root/legacy/sessions';
import { listRootConnections } from '../src/server/root/legacy/connections';
import { callRootLegacyTool, rootLegacyToolDefinitions, rootLegacyResources } from '../src/server/root/legacy/mcp';
import { DELETE as signOutRoute } from '../src/app/api/root/sessions/[id]/route';
import { GET as connectionsRoute } from '../src/app/api/root/connections/route';
import { ROOT_OPERATIONS_COPY, rootCopyLocale } from '../src/server/root/legacy/copy';

const root = { isInstanceOwner: true, disabledAt: null };
const future = new Date(Date.now() + 3600_000);

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.user.findUnique.mockResolvedValue(root);
  h.tx.user.findUnique.mockResolvedValue(root);
  h.tx.$queryRaw.mockResolvedValue([]);
  h.tx.$executeRaw.mockResolvedValue(1);
});

describe('Root sessions', () => {
  it('refuses a workspace owner who is not installation owner', async () => {
    h.prisma.user.findUnique.mockResolvedValue({ isInstanceOwner: false, disabledAt: null });
    await expect(listRootSessions('u1')).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.prisma.session.findMany).not.toHaveBeenCalled();
  });

  it('lists bounded sessions without token material and flags truncation and the current browser', async () => {
    const row = (id: string, pending: string | null = null) => ({ id, expiresAt: future, pending, tokenHash: 'never', user: { id: 'u', email: 'a@example.test', name: 'A', disabledAt: null, isInstanceOwner: false } });
    h.prisma.session.findMany.mockResolvedValue([row('s1'), row('s2', 'totp'), row('s3')]);
    const result = await listRootSessions('root', { q: 'a@' }, undefined, 's1');
    expect(h.prisma.session.findMany.mock.calls[0][0].take).toBe(3);
    expect(h.prisma.session.findMany.mock.calls[0][0].select).not.toHaveProperty('tokenHash');
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: 's1', current: true, verified: true });
    expect(result.items[1]).toMatchObject({ verified: false, current: false });
    expect(JSON.stringify(result)).not.toContain('never');
  });

  it('rejects unknown filters and long searches', async () => {
    await expect(listRootSessions('root', { all: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(listRootSessions('root', { q: 'x'.repeat(51) })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('requires the exact confirmation before any transaction work', async () => {
    await expect(signOutRootSession('root', 's1', { confirmation: 'SIGN OUT SESSION s2' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.tx.session.findUnique).not.toHaveBeenCalled();
  });

  it('signs out one session with an atomic audit after locking actor and owner', async () => {
    h.tx.session.findUnique.mockResolvedValue({ id: 's1', userId: 'u9' });
    h.tx.session.deleteMany.mockResolvedValue({ count: 1 });
    await expect(signOutRootSession('root', 's1', { confirmation: 'SIGN OUT SESSION s1' })).resolves.toEqual({ signedOut: true, sessionId: 's1', userId: 'u9' });
    expect(h.tx.$queryRaw).toHaveBeenCalled();
    expect(h.tx.session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1', userId: 'u9' } });
    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('reports a missing or concurrently removed session truthfully', async () => {
    h.tx.session.findUnique.mockResolvedValue(null);
    await expect(signOutRootSession('root', 's1', { confirmation: 'SIGN OUT SESSION s1' })).rejects.toMatchObject({ code: 'not_found' });
    h.tx.session.findUnique.mockResolvedValue({ id: 's1', userId: 'u9' });
    h.tx.session.deleteMany.mockResolvedValue({ count: 0 });
    await expect(signOutRootSession('root', 's1', { confirmation: 'SIGN OUT SESSION s1' })).rejects.toMatchObject({ code: 'conflict' });
    expect(h.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('denies disabled installation owners inside the transaction', async () => {
    h.tx.session.findUnique.mockResolvedValue({ id: 's1', userId: 'u9' });
    h.tx.user.findUnique.mockResolvedValue({ isInstanceOwner: true, disabledAt: new Date() });
    await expect(signOutRootSession('root', 's1', { confirmation: 'SIGN OUT SESSION s1' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.tx.session.deleteMany).not.toHaveBeenCalled();
  });
});

describe('Root connections', () => {
  it('returns neutral read-only rows without credentials', async () => {
    h.prisma.socialAccount.count.mockResolvedValue(1);
    h.prisma.socialAccount.findMany.mockResolvedValue([{ id: 'c1', provider: 'facebook', name: 'Example', scopes: 'a,b c', accessToken: 'SECRET', tokenExpiresAt: new Date(Date.now() - 1000), invalidatedAt: null, invalidReason: null, createdAt: new Date(), workspace: { id: 'w1', name: 'W' }, targets: [{ enabled: true }, { enabled: false }] }]);
    const result = await listRootConnections('root', { state: 'expired' });
    expect(h.prisma.socialAccount.findMany.mock.calls[0][0].select).not.toHaveProperty('accessToken');
    expect(h.prisma.socialAccount.findMany.mock.calls[0][0].select).not.toHaveProperty('refreshToken');
    expect(result.items[0]).toMatchObject({ state: 'expired', scopeCount: 3, installed: true, channels: { selected: 1, discovered: 2 } });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('redacts credential-shaped invalidation reasons and validates filters', async () => {
    h.prisma.socialAccount.count.mockResolvedValue(1);
    h.prisma.socialAccount.findMany.mockResolvedValue([{ id: 'c1', provider: 'other', name: 'X', scopes: '', tokenExpiresAt: null, invalidatedAt: new Date(), invalidReason: 'access_token=abcdef123456 rejected', createdAt: new Date(), workspace: { id: 'w', name: 'W' }, targets: [] }]);
    const result = await listRootConnections('root', {});
    expect(result.items[0].invalidReason).not.toContain('abcdef123456');
    expect(result.items[0]).toMatchObject({ state: 'revoked', installed: false });
    await expect(listRootConnections('root', { provider: '../x' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('HTTP and MCP surfaces', () => {
  it('hides routes from non-owners and refuses cross-origin writes', async () => {
    h.actor.mockResolvedValue({ id: 'u', isInstanceOwner: false });
    expect((await connectionsRoute(new Request('http://x/api/root/connections'), undefined)).status).toBe(404);
    h.actor.mockResolvedValue(null);
    expect((await connectionsRoute(new Request('http://x/api/root/connections'), undefined)).status).toBe(401);
    const cross = new Request('http://x/api/root/sessions/s1', { method: 'DELETE', headers: { origin: 'http://evil' }, body: '{}' });
    expect((await signOutRoute(cross, { params: Promise.resolve({ id: 's1' }) })).status).toBe(403);
  });

  it('installs tools/resources and refuses API keys and wrong confirmations', async () => {
    expect(rootLegacyToolDefinitions.map(tool => tool.name)).toEqual(expect.arrayContaining(['list_root_sessions', 'sign_out_root_session', 'list_root_connections']));
    expect(rootLegacyResources.map(resource => resource.uri)).toEqual(expect.arrayContaining(['msp://root/sessions', 'msp://root/connections']));
    await expect(callRootLegacyTool({ userId: 'root', isInstanceOwner: true, apiKeyId: 'k' } as never, 'list_root_sessions', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(callRootLegacyTool({ userId: 'root', isInstanceOwner: true } as never, 'sign_out_root_session', { sessionId: 's1', confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('copy', () => {
  it('has the same keys in English and French and picks the browser language', () => {
    expect(Object.keys(ROOT_OPERATIONS_COPY.fr).sort()).toEqual(Object.keys(ROOT_OPERATIONS_COPY.en).sort());
    expect(rootCopyLocale('fr-CA,fr;q=0.9')).toBe('fr');
    expect(rootCopyLocale('de,en;q=0.5')).toBe('en');
    expect(rootCopyLocale(null)).toBe('en');
  });
});
