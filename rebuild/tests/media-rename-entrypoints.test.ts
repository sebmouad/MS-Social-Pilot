import { beforeEach, expect, it, vi } from 'vitest';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
const state = vi.hoisted(() => ({ rename: vi.fn(), viewer: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example' }));
vi.mock('@/modules/media/server/library', () => ({ renameAsset: state.rename }));
vi.mock('@/modules/media/server/messages', () => ({ mediaMessage: async (message: string) => message, mediaError: async (code: OperationErrorCode, message: string) => new OperationError(code, message) }));
import { renameMediaHttp } from '@/modules/media/server/http';
import { renameMediaAction } from '@/modules/media/ui/rename-action';
import { executeMediaTool } from '@/modules/media/mcp';
const actor = { userId: 'u1', workspaceId: 'w1' };
const args = { name: 'clip.mp4', confirmation: 'RENAME MEDIA m1' };
const context = { params: Promise.resolve({ id: 'm1' }) };
const request = (body: unknown, origin = 'https://app.example') => new Request('https://app.example/api/media-library/m1', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); state.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' }); state.rename.mockResolvedValue({ id: 'm1', name: 'clip.mp4', renamed: true }); });
it('HTTP, server action and MCP pass the same intent to the shared service', async () => {
  expect((await renameMediaHttp(request(args), context)).status).toBe(200);
  await renameMediaAction({ ...args, id: 'm1' });
  await executeMediaTool(actor, 'rename_media_asset', { ...args, id: 'm1' });
  expect(state.rename.mock.calls).toEqual(Array.from({ length: 3 }, () => [actor, { ...args, id: 'm1' }]));
});
it('HTTP refuses cross-origin requests and body identity substitution', async () => {
  expect((await renameMediaHttp(request(args, 'https://other.example'), context)).status).toBe(403);
  expect((await renameMediaHttp(request({ ...args, id: 'other' }), context)).status).toBe(400);
  expect(state.rename).not.toHaveBeenCalled();
});
it('HTTP refuses a missing session before calling the service', async () => {
  state.viewer.mockRejectedValue(new Error('no session'));
  expect((await renameMediaHttp(request(args), context)).status).toBe(401);
  expect(state.rename).not.toHaveBeenCalled();
});
