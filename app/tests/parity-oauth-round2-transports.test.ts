import { beforeEach, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const m = vi.hoisted(() => ({ actor: vi.fn(), service: vi.fn(), config: vi.fn(), set: vi.fn(), viewer: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: m.set }) }));
vi.mock('@/modules/settings/server/account-session', () => ({ accountSessionActor: m.actor }));
vi.mock('@/modules/settings/server/connection-start', () => ({ startConnection: m.service }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.test' }));
import { CONNECTION_START_MCP } from '@/modules/settings/connection-start-mcp';
import { connectionStartHttp } from '@/modules/settings/server/connection-start-http';
const viewer = { userId: 'user', workspaceId: 'workspace' } as never;
const actor = { userId: 'user', workspaceId: 'workspace', sessionTokenHash: 'hash' };
const args = { platform: 'example', confirmation: 'START CONNECTION example' };
beforeEach(() => {
  vi.clearAllMocks(); m.actor.mockResolvedValue(actor); m.config.mockResolvedValue('https://app.test'); m.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace' });
  m.service.mockImplementation(async () => { const response = NextResponse.json({ authorizationUrl: 'https://provider.test/consent', extra: 'private' }); response.cookies.set('state', 'private-cookie', { httpOnly: true, path: '/callback' }); return response; });
});
it('MCP returns only URL and writes private cookies to the response context', async () => {
  const result = await CONNECTION_START_MCP.execute(viewer, 'start_connection', args, 10);
  expect(result).toEqual({ authorizationUrl: 'https://provider.test/consent' });
  expect(m.set).toHaveBeenCalledWith(expect.objectContaining({ name: 'state', value: 'private-cookie', httpOnly: true, path: '/callback' }));
  expect(m.service.mock.calls[0]![0]).toEqual(actor); expect(m.service.mock.calls[0]![1]).toEqual(args); expect(m.service.mock.calls[0]![2].url).toBe('https://app.test/api/oauth/connections/start');
});
it('MCP hides/refuses bearer keys and refuses absent configured origin', async () => {
  const key = { userId: 'user', workspaceId: 'workspace', apiKeyId: 'key' } as never;
  expect((await CONNECTION_START_MCP.available!(key))('start_connection')).toBe(false);
  await expect(CONNECTION_START_MCP.execute(key, 'start_connection', args, 10)).rejects.toMatchObject({ code: 'forbidden' });
  m.config.mockResolvedValue(''); await expect(CONNECTION_START_MCP.execute(viewer, 'start_connection', args, 10)).rejects.toMatchObject({ code: 'unavailable' }); expect(m.service).not.toHaveBeenCalled();
});
it('REST dispatches the identical confirmation and preserves Set-Cookie', async () => {
  const request = new Request('https://app.test/start', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: args.confirmation }) });
  const response = await connectionStartHttp(request, 'example');
  expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('private-cookie'); expect(m.service).toHaveBeenCalledWith(actor, args, request);
});
it.each<Record<string, string>>([{ authorization: 'Bearer key', origin: 'https://app.test' }, { origin: 'https://evil.test' }])('REST refuses non-session or cross-origin callers before service %j', async headers => {
  const response = await connectionStartHttp(new Request('https://app.test/start', { method: 'POST', headers }), 'example'); expect(response.status).toBe(403); expect(m.service).not.toHaveBeenCalled();
});
it('REST rejects malformed JSON and extra properties', async () => {
  for (const body of ['bad json', JSON.stringify({ confirmation: args.confirmation, platform: 'other' })]) {
    const response = await connectionStartHttp(new Request('https://app.test/start', { method: 'POST', headers: { origin: 'https://app.test' }, body }), 'example'); expect(response.status).toBe(400);
  }
  expect(m.service).not.toHaveBeenCalled();
});
