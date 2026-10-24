import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), read: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example.test' }));
vi.mock('@/modules/notifications/chat-channels/server/service', () => ({ listChatChannels: mocks.read, createChatChannel: mocks.create, updateChatChannel: mocks.update, deleteChatChannel: mocks.remove, testChatChannel: mocks.test }));
import { GET, POST, PATCH, DELETE, TEST } from '@/modules/notifications/chat-channels/http';
beforeEach(() => { vi.resetAllMocks(); mocks.viewer.mockResolvedValue({ user: { id: 'owner' }, workspaceId: 'tenant-a' }); mocks.read.mockResolvedValue({ channels: [] }); mocks.create.mockResolvedValue({ id: 'chat-a', saved: true }); mocks.update.mockResolvedValue({ id: 'chat-a', saved: true }); mocks.remove.mockResolvedValue({ id: 'chat-a', deleted: true }); mocks.test.mockResolvedValue({ id: 'chat-a', outcome: 'accepted' }); });
const request = (path: string, method: string, body?: unknown, origin = 'https://app.example.test') => new Request(`https://app.example.test${path}`, { method, headers: { origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
it('routes list and create to the shared service with session tenant', async () => {
  expect((await GET(request('/api/chat-channels', 'GET'))).status).toBe(200);
  expect(mocks.read).toHaveBeenCalledWith({ userId: 'owner', workspaceId: 'tenant-a' });
  expect((await POST(request('/api/chat-channels', 'POST', { name: 'Team' }))).status).toBe(201);
  expect(mocks.create).toHaveBeenCalledWith({ userId: 'owner', workspaceId: 'tenant-a' }, { name: 'Team' });
});
it('routes update/delete/test with URL-selected ID and unchanged confirmation', async () => {
  const context = { params: Promise.resolve({ id: 'chat-a' }) };
  await PATCH(request('/api/chat-channels/chat-a', 'PATCH', { enabled: false, confirmation: 'UPDATE CHAT CHANNEL chat-a' }), context);
  await DELETE(request('/api/chat-channels/chat-a', 'DELETE', { confirmation: 'DELETE CHAT CHANNEL chat-a' }), context);
  await TEST(request('/api/chat-channels/chat-a/test', 'POST', { confirmation: 'TEST CHAT CHANNEL chat-a' }), context);
  expect(mocks.update.mock.calls[0]?.[1]).toEqual({ id: 'chat-a', enabled: false, confirmation: 'UPDATE CHAT CHANNEL chat-a' });
  expect(mocks.remove.mock.calls[0]?.[1]).toEqual({ id: 'chat-a', confirmation: 'DELETE CHAT CHANNEL chat-a' });
  expect(mocks.test.mock.calls[0]?.[1]).toEqual({ id: 'chat-a', confirmation: 'TEST CHAT CHANNEL chat-a' });
});
it('denies cross-origin writes and body ID overrides before service execution', async () => {
  expect((await POST(request('/api/chat-channels', 'POST', { name: 'Team' }, 'https://evil.test'))).status).toBe(403);
  expect((await PATCH(request('/api/chat-channels/chat-a', 'PATCH', { id: 'other-tenant' }), { params: Promise.resolve({ id: 'chat-a' }) })).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it('maps anonymous session redirects to safe unauthorized responses', async () => {
  mocks.viewer.mockRejectedValue({ digest: 'NEXT_REDIRECT;replace;/sign-in;307;' });
  const response = await GET(request('/api/chat-channels', 'GET'));
  expect(response.status).toBe(401); expect(mocks.read).not.toHaveBeenCalled();
});
