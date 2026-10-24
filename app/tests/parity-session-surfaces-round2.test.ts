import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ viewer: vi.fn(), actor: vi.fn(), appearance: vi.fn(), authorize: vi.fn(), reveal: vi.fn(), rotate: vi.fn(), sharingActor: vi.fn(), channels: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example.test' }));
vi.mock('@/modules/settings/server/account-session', () => ({ accountSessionActor: m.actor }));
vi.mock('@/modules/settings/server/appearance', () => ({ appearanceSession: m.appearance }));
vi.mock('@/modules/settings/server/account', () => ({ authorizeAccountSession: m.authorize }));
vi.mock('@/modules/integrations/server/webhooks', () => ({ revealWebhookSecret: m.reveal, rotateWebhookSecret: m.rotate }));
vi.mock('@/modules/sharing/server/links', () => ({ listShareableChannels: m.channels }));
import { SESSION_PARITY_MCP } from '@/modules/settings/session-parity-mcp';
import { GET, PATCH } from '@/app/api/settings/appearance/route';
import { POST as rotate } from '@/app/api/webhooks/[id]/secret/route';
import { POST as reveal } from '@/app/api/webhooks/[id]/secret/reveal/route';
import { GET as channels } from '@/app/api/sharing/channels/route';
import type { McpViewer } from '@/server/mcp/types';
const viewer = { userId: 'u', workspaceId: 'w' } as McpViewer;
const identity = { userId: 'u', workspaceId: 'w', sessionTokenHash: 'hash' };
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`https://app.example.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://app.example.test', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.clearAllMocks(); m.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' }); m.actor.mockResolvedValue(identity); m.authorize.mockResolvedValue(undefined);
  m.appearance.mockResolvedValue({ theme: 'meta', mode: 'system', modePersistence: 'account' }); m.reveal.mockResolvedValue({ id: 'hook', secret: 'synthetic-signing-secret' }); m.rotate.mockResolvedValue({ id: 'hook', secret: 'new-synthetic-signing-secret' }); m.channels.mockResolvedValue([{ id: 'channel', name: 'Example channel' }]);
});
it('REST and MCP appearance invoke exactly the same session service', async () => {
  const body = { theme: 'meta', mode: 'system', confirmation: 'UPDATE APPEARANCE' };
  expect((await GET(request('/api/settings/appearance'))).status).toBe(200);
  expect(m.appearance).toHaveBeenLastCalledWith(identity, undefined);
  expect(await SESSION_PARITY_MCP.execute(viewer, 'get_appearance', {}, 10)).toMatchObject({ modePersistence: 'account' });
  expect(m.appearance).toHaveBeenLastCalledWith(identity);
  expect((await PATCH(request('/api/settings/appearance', body))).status).toBe(200);
  expect(m.appearance).toHaveBeenLastCalledWith(identity, body);
  await SESSION_PARITY_MCP.execute(viewer, 'update_appearance', body, 10);
  expect(m.appearance).toHaveBeenLastCalledWith(identity, body);
});
it('refuses bearer access for both appearance surfaces before sessions or writes', async () => {
  expect((await GET(request('/api/settings/appearance', undefined, { authorization: 'Bearer sample' }))).status).toBe(403);
  await expect(SESSION_PARITY_MCP.execute({ ...viewer, apiKeyId: 'key' }, 'get_appearance', {}, 10)).rejects.toMatchObject({ code: 'forbidden' });
  expect(m.actor).not.toHaveBeenCalled();
  expect(m.appearance).not.toHaveBeenCalled();
});
it('refuses cross-origin appearance writes, invalid JSON and anonymous reads safely', async () => {
  expect((await PATCH(request('/api/settings/appearance', {}, { origin: 'https://foreign.test' }))).status).toBe(403);
  expect((await PATCH(new Request('https://app.example.test/api/settings/appearance', { method: 'PATCH', headers: { origin: 'https://app.example.test' }, body: 'bad json' }))).status).toBe(400);
  m.viewer.mockRejectedValueOnce({ digest: 'NEXT_REDIRECT;/sign-in' });
  expect((await GET(request('/api/settings/appearance'))).status).toBe(401);
});
it.each(['reveal', 'rotate'] as const)('REST/MCP %s use the same confirmed, audited owning secret service', async action => {
  const confirmation = `${action === 'reveal' ? 'REVEAL' : 'ROTATE'} WEBHOOK SECRET hook`;
  const input = { id: 'hook', confirmation };
  const params = { params: Promise.resolve({ id: 'hook' }) };
  const response = await (action === 'reveal' ? reveal : rotate)(request(`/api/webhooks/hook/secret`, { confirmation }), params);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const result = await SESSION_PARITY_MCP.execute(viewer, action === 'reveal' ? 'reveal_webhook_secret' : 'rotate_webhook_secret_once', input, 10);
  expect(result).toEqual(await response.json());
  expect(m.authorize).toHaveBeenCalledWith(identity, true, 'settings/webhooks');
  expect(action === 'reveal' ? m.reveal : m.rotate).toHaveBeenLastCalledWith({ userId: 'u', workspaceId: 'w' }, input);
});
it('refuses secret credential fallback, CSRF, mismatched resource IDs and missing session authority', async () => {
  const params = { params: Promise.resolve({ id: 'hook' }) };
  expect((await reveal(request('/api/webhooks/hook/secret', {}, { 'x-api-key': 'key' }), params)).status).toBe(403);
  expect((await reveal(request('/api/webhooks/hook/secret', {}, { origin: 'https://foreign.test' }), params)).status).toBe(403);
  expect((await reveal(request('/api/webhooks/hook/secret', { id: 'other' }), params)).status).toBe(400);
  await expect(SESSION_PARITY_MCP.execute({ ...viewer, apiKeyId: 'key' }, 'rotate_webhook_secret_once', {}, 10)).rejects.toMatchObject({ code: 'forbidden' });
  expect(m.reveal).not.toHaveBeenCalled(); expect(m.rotate).not.toHaveBeenCalled();
});
it('sharing channels REST delegates scope to the same authorized picker/MCP core', async () => {
  const response = await channels(request('/api/sharing/channels'));
  expect(await response.json()).toEqual({ channels: [{ id: 'channel', name: 'Example channel' }] });
  expect(m.channels).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await channels(request('/api/sharing/channels?all=true'))).status).toBe(400);
  expect((await channels(request('/api/sharing/channels', undefined, { authorization: 'Bearer sample' }))).status).toBe(403);
});
