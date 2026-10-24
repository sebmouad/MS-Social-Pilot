import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), overview: vi.fn(), clients: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/modules/agency/server/agency', () => ({ agencyOverview: mocks.overview, listAgencyClients: mocks.clients }));
import { GET as GET_AGENCY } from '../src/app/api/agency/route';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' });
  mocks.overview.mockResolvedValue({ ok: true }); mocks.clients.mockResolvedValue({ ok: true });
});
const base = 'http://app.test/api/agency';
describe('agency API', () => {
  it('uses only the signed-in person and strict filters', async () => {
    expect((await GET_AGENCY(new Request(`${base}?sort=failed&attention=true`))).status).toBe(200);
    expect(mocks.overview).toHaveBeenCalledWith({ userId: 'u1' }, { sort: 'failed', attentionOnly: true });
    expect((await GET_AGENCY(new Request(`${base}?view=clients&q=ann`))).status).toBe(200);
    expect(mocks.clients).toHaveBeenCalledWith({ userId: 'u1' }, { q: 'ann' });
    for (const bad of ['?workspaceId=w2', '?view=other', '?view=clients&sort=name', '?attention=1', '?q=a&q=b']) expect((await GET_AGENCY(new Request(base + bad))).status).toBe(400);
  });
  it('is person-wide, so the selected workspace role cannot gate it, and never uses the workspace in the request', async () => {
    await GET_AGENCY(new Request(base));
    expect(mocks.viewer).toHaveBeenCalledWith({ channelScoped: true });
    expect(mocks.overview.mock.calls[0]![0]).toEqual({ userId: 'u1' });
  });
  it('answers 401/403 instead of 502 when the viewer guard redirects, without leaking the redirect', async () => {
    mocks.viewer.mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/sign-in;307;' }));
    const anonymous = await GET_AGENCY(new Request(base));
    expect(anonymous.status).toBe(401);
    expect(JSON.stringify(await anonymous.json())).not.toMatch(/REDIRECT|sign-in/);
    mocks.viewer.mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/access-limited;307;' }));
    expect((await GET_AGENCY(new Request(base))).status).toBe(403);
    mocks.viewer.mockRejectedValueOnce(new Error('db down'));
    expect((await GET_AGENCY(new Request(base))).status).toBe(502);
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it('refuses API-key and bearer credentials before reading anything', async () => {
    for (const [name, value] of [['authorization', 'Bearer key'], ['x-api-key', 'key']] as const) {
      const headers = new Headers(); headers.set(name, value);
      const response = await GET_AGENCY(new Request(base, { headers }));
      expect(response.status).toBe(403);
    }
    expect(mocks.viewer).not.toHaveBeenCalled(); expect(mocks.overview).not.toHaveBeenCalled();
  });
});
