import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '@/lib/operation-error';
const m = vi.hoisted(() => ({ directory: vi.fn(), viewer: vi.fn(), accounts: vi.fn(), performance: vi.fn(), options: vi.fn(), readAccount: vi.fn(), updateAccountProfile: vi.fn(), changeAccountPassword: vi.fn(), listAccountSessions: vi.fn(), revokeAccountSession: vi.fn(), session: vi.fn(), cookie: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: m.session }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: m.cookie }) }));
vi.mock('@/modules/ads/server/performance', () => ({ listAdsAccounts: m.accounts, readAdsPerformance: m.performance }));
vi.mock('@/modules/ads/server/creation-options', () => ({ readAdsCreationOptions: m.options }));
vi.mock('@/modules/settings/server/account', () => m);
vi.mock('@/server/data-control', () => ({ exportWorkspaceData: m.snapshot }));
vi.mock('@/modules/settings/server/connection-directory', () => ({ readConnectionDirectory: m.directory }));
import { GET as connections } from '@/app/api/settings/connections/route';
import { GET as accounts } from '@/app/api/ads/accounts/route';
import { GET as performance } from '@/app/api/ads/performance/route';
import { GET as options } from '@/app/api/ads/creation-options/route';
import { GET as account, PATCH, POST } from '@/app/api/settings/account/route';
import { GET as sessions, DELETE } from '@/app/api/settings/account/sessions/route';
import { GET as snapshot } from '@/app/api/settings/data/snapshot/route';
const actor = { userId: 'user', workspaceId: 'workspace' };
const request = (url: string, method = 'GET', body?: unknown, origin = 'https://app.test') => new Request(`https://app.test${url}`, { method, headers: { origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  vi.clearAllMocks(); m.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace' });
  for (const fn of [m.accounts, m.performance, m.options, m.readAccount, m.updateAccountProfile, m.changeAccountPassword, m.listAccountSessions, m.revokeAccountSession, m.snapshot]) fn.mockResolvedValue({ ok: true });
  m.cookie.mockReturnValue({ value: 'A'.repeat(43) });
  m.session.mockResolvedValue({ userId: 'user', user: { id: 'user', disabledAt: null }, pending: null, expiresAt: new Date('2099-01-01') });
});
describe('Ads REST parity', () => {
  it.each([[accounts, m.accounts], [performance, m.performance], [options, m.options]])('rechecks identity through the shared service and returns no-store', async (route, service) => {
    const response = await route(request('/api/ads/read?accountId=one'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(service).toHaveBeenCalledWith(actor, { accountId: 'one' });
    m.viewer.mockRejectedValue(new Error('NEXT_REDIRECT'));
    expect((await route(request('/api/ads/read'))).status).toBe(401);
  });
  it('preserves strict numeric and duplicate filter validation', async () => {
    await performance(request('/api/ads/performance?offset=2&limit=3'));
    expect(m.performance).toHaveBeenCalledWith(actor, { offset: 2, limit: 3 });
    expect((await performance(request('/api/ads/performance?offset=2&offset=3'))).status).toBe(400);
    expect(m.performance).toHaveBeenCalledTimes(1);
    m.performance.mockRejectedValue(new OperationError('forbidden', 'Not available.'));
    expect((await performance(request('/api/ads/performance'))).status).toBe(403);
  });
});
describe('account REST parity', () => {
  it('gets profile and session pages using validated current session authority', async () => {
    expect((await account(request('/api/settings/account'))).status).toBe(200);
    expect(m.readAccount).toHaveBeenCalledWith(expect.objectContaining(actor));
    expect((await sessions(request('/api/settings/account/sessions?offset=2'))).status).toBe(200);
    expect(m.listAccountSessions).toHaveBeenCalledWith(expect.objectContaining(actor), { offset: 2 });
    expect((await sessions(request('/api/settings/account/sessions?offset=bad'))).status).toBe(400);
  });
  it.each([[PATCH, m.updateAccountProfile], [POST, m.changeAccountPassword], [DELETE, m.revokeAccountSession]])('uses the service confirmation payload and refuses cross-origin writes first', async (route, service) => {
    const input = { confirmation: 'reviewed' };
    expect((await route(request('/api/settings/account', 'POST', input, 'https://evil.test'))).status).toBe(403);
    expect(m.viewer).not.toHaveBeenCalled();
    expect((await route(request('/api/settings/account', 'POST', input))).status).toBe(200);
    expect(service).toHaveBeenCalledWith(expect.objectContaining(actor), input);
  });
  it('refuses bearer credentials, absent cookies and mismatched session users', async () => {
    const bearer = new Request('https://app.test/api/settings/account', { headers: { authorization: 'Bearer credential' } });
    expect((await account(bearer)).status).toBe(403);
    m.cookie.mockReturnValue(undefined);
    expect((await account(request('/api/settings/account'))).status).toBe(401);
    m.cookie.mockReturnValue({ value: 'A'.repeat(43) });
    m.session.mockResolvedValue({ userId: 'other', user: { id: 'other', disabledAt: null }, pending: null, expiresAt: new Date('2099-01-01') });
    expect((await account(request('/api/settings/account'))).status).toBe(401);
    expect(m.readAccount).not.toHaveBeenCalled();
  });
});
it('adds the synchronous redacted JSON snapshot read through its existing service', async () => {
  expect((await snapshot()).status).toBe(200);
  expect(m.snapshot).toHaveBeenCalledWith(actor);
});

it('routes the Settings connection directory to the authorized shared read with strict paging', async () => {
 m.directory.mockResolvedValue({ connections: [], nextOffset: null });
 expect((await connections(request('/api/settings/connections?offset=2'))).status).toBe(200);
 expect(m.directory).toHaveBeenCalledWith(actor,{offset:2});
 expect((await connections(request('/api/settings/connections?offset=-1'))).status).toBe(400);
 expect((await connections(request('/api/settings/connections?offset=1&offset=2'))).status).toBe(400);
});
