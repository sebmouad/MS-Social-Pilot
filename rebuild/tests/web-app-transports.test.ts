import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ viewer: vi.fn(), actor: vi.fn(), read: vi.fn(), prepare: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.test' }));
vi.mock('@/modules/settings/server/account-session', () => ({ accountSessionActor: m.actor }));
vi.mock('@/modules/settings/web-app/service', () => ({ INSTALL_CONFIRMATION: 'PREPARE WEB APP INSTALLATION', readWebApp: m.read, prepareWebApp: m.prepare }));
import { GET, POST } from '@/app/api/settings/web-app/route';
import { WEB_APP_MCP } from '@/modules/settings/web-app/mcp';
const actor = { userId: 'user', workspaceId: 'workspace', sessionTokenHash: 'hash' };
const viewer = { userId: 'user', workspaceId: 'workspace' } as Parameters<typeof WEB_APP_MCP.execute>[0];
beforeEach(() => {
  vi.clearAllMocks(); m.actor.mockResolvedValue(actor); m.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace' });
  m.read.mockResolvedValue({ name: 'public-brand' }); m.prepare.mockResolvedValue({ prepared: true, installed: false });
});
it('REST and MCP read/write entrypoints call the same service with exact actor and consent', async () => {
  expect(await (await GET(new Request('https://app.test/api/settings/web-app'))).json()).toEqual({ name: 'public-brand' });
  expect(await WEB_APP_MCP.execute(viewer, 'get_web_app', {}, 10)).toEqual({ name: 'public-brand' });
  const args = { confirmation: 'PREPARE WEB APP INSTALLATION' };
  expect((await POST(new Request('https://app.test/api/settings/web-app', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify(args) }))).status).toBe(200);
  await WEB_APP_MCP.execute(viewer, 'prepare_web_app_installation', args, 10);
  expect(m.read.mock.calls).toEqual([[actor], [actor]]); expect(m.prepare.mock.calls).toEqual([[actor, args], [actor, args]]);
});
it('refuses cross-origin, malformed JSON and bearer access without reaching the service', async () => {
  expect((await POST(new Request('https://app.test/api/settings/web-app', { method: 'POST', headers: { origin: 'https://evil.test' } }))).status).toBe(403);
  expect((await POST(new Request('https://app.test/api/settings/web-app', { method: 'POST', headers: { origin: 'https://app.test' }, body: '{' }))).status).toBe(400);
  expect((await GET(new Request('https://app.test/api/settings/web-app', { headers: { authorization: 'Bearer invalid' } }))).status).toBe(403);
  await expect(WEB_APP_MCP.execute({ ...viewer, apiKeyId: 'key' }, 'get_web_app', {}, 10)).rejects.toMatchObject({ code: 'forbidden' });
  expect(m.read).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled();
});
it('maps expired session redirects to a safe 401', async () => {
  m.viewer.mockRejectedValueOnce({ digest: 'NEXT_REDIRECT;replace;/sign-in;307;' });
  const response = await GET(new Request('https://app.test/api/settings/web-app'));
  expect(response.status).toBe(401); expect(m.read).not.toHaveBeenCalled();
});
