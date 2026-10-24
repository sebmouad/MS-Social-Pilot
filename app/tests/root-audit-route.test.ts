import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), export: vi.fn() }));
vi.mock('@/server/config/access', () => ({ currentRootActor: mocks.actor }));
vi.mock('@/server/root/audit-export', () => ({ exportRootActivity: mocks.export }));
import { GET } from '../src/app/api/root/activity/export/route';
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); mocks.export.mockResolvedValue({ filename: 'root-activity.csv', csv: 'safe\r\n' }); });
it('returns a private CSV attachment with matching filters', async () => {
  const response = await GET(new Request('https://example.invalid/api/root/activity/export?workspaceId=ws&q=test'));
  expect(response.status).toBe(200); expect(await response.text()).toBe('safe\r\n');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-disposition')).toContain('attachment');
  expect(mocks.export).toHaveBeenCalledWith('root', { workspaceId: 'ws', q: 'test' });
});
it.each([null, { id: 'member', isInstanceOwner: false }])('denies non-Root requests', async actor => {
  mocks.actor.mockResolvedValue(actor);
  expect((await GET(new Request('https://example.invalid/api/root/activity/export'))).status).toBe(actor ? 404 : 401);
  expect(mocks.export).not.toHaveBeenCalled();
});
it('rejects duplicate filters before invoking export', async () => {
  expect((await GET(new Request('https://example.invalid/api/root/activity/export?q=a&q=b'))).status).toBe(400);
  expect(mocks.export).not.toHaveBeenCalled();
});
it('does not leak internal failure messages', async () => {
  mocks.export.mockRejectedValue(new Error('private database connection'));
  const response = await GET(new Request('https://example.invalid/api/root/activity/export'));
  expect(response.status).toBe(502); expect(await response.text()).not.toContain('private database');
});
