import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ read: vi.fn(), viewer: vi.fn() }));
vi.mock('@/modules/publishing/server/best-time', () => ({ getBestTimeSuggestions: h.read }));
vi.mock('@/server/context', () => ({ requireViewer: h.viewer }));
import { GET } from '@/app/api/publishing/best-times/route';
import { PUBLISHING_MCP } from '@/modules/publishing/mcp';
import type { McpViewer } from '@/server/mcp/types';
const result = { mode: 'suggest', timeZone: 'UTC', windowDays: 90, suggestions: [], perTarget: [] };
beforeEach(() => { vi.clearAllMocks(); h.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' }); h.read.mockResolvedValue(result); });
it('HTTP reads share the authorized service and are not cached', async () => {
  const response = await GET(new Request('https://example.test/api/publishing/best-times?targetId=a&targetId=b'));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(result);
  expect(h.viewer).toHaveBeenCalledWith({ feature: 'publishing/posts', channelScoped: true });
  expect(h.read).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, { targetIds: ['a', 'b'] });
});
it('HTTP rejects unauthenticated and foreign query input before reading', async () => {
  h.viewer.mockRejectedValueOnce(new Error('not signed in'));
  expect((await GET(new Request('https://example.test/api/publishing/best-times?targetId=a'))).status).toBe(401);
  expect((await GET(new Request('https://example.test/api/publishing/best-times?workspaceId=other'))).status).toBe(400);
  expect(h.read).not.toHaveBeenCalled();
});
it('MCP declares resource scope and passes the credential channel ceiling to the same service', async () => {
  const group = PUBLISHING_MCP.find(g => g.id === 'publishing-best-times')!;
  expect(group.features.get_best_times).toBe('publishing/posts');
  expect(group.scope.resourceTools).toContain('get_best_times');
  const viewer = { userId: 'u', workspaceId: 'w', permissions: { pageScope: { all: false, ids: ['a'] } } } as unknown as McpViewer;
  expect(await group.execute(viewer, 'get_best_times', { targetIds: ['a'] }, 100)).toEqual(result);
  expect(h.read).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w', allowedTargetIds: ['a'] }, { targetIds: ['a'] });
});

it('HTTP adds server-formatted slot labels in the workspace zone so browsers never format them', async () => {
  h.read.mockResolvedValue({ mode: 'suggest', timeZone: 'Africa/Casablanca', windowDays: 90, suggestions: [{ nextAt: '2026-10-22T14:30:00.000Z', date: '2026-10-22', time: '15:30' }], perTarget: [] });
  const body = await (await GET(new Request('https://example.test/api/publishing/best-times?targetId=a'))).json();
  expect(body.suggestions[0].label).toContain('15:30');
});
