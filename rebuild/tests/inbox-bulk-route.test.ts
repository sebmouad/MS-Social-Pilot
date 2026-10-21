import { beforeEach, expect, it, vi } from 'vitest';
import { OperationError } from '@/lib/operation-error';
const m = vi.hoisted(() => ({ viewer: vi.fn(), authorize: vi.fn(), resolved: vi.fn(), moderate: vi.fn(), remove: vi.fn(), config: vi.fn(), guard: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example' }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: m.authorize }));
vi.mock('@/modules/inbox/server/actions', () => ({ setInboxResolved: m.resolved, moderateInboxComment: m.moderate, deleteInboxComment: m.remove }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: m.guard }));
import { POST } from '@/app/api/inbox/bulk/route';
const actor = { userId: 'user', workspaceId: 'workspace' };
const items = [{ kind: 'comment', id: 'one' }];
const input = { action: 'resolve', items, confirmation: 'BULK RESOLVE 1 INBOX ITEMS' };
const request = (body: unknown = input, origin: string | null = 'https://app.example', query = '') => new Request(`https://app.example/api/inbox/bulk${query}`, { method: 'POST', headers: { ...(origin === null ? {} : { origin }), 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); m.viewer.mockResolvedValue({ user: { id: actor.userId }, workspaceId: actor.workspaceId });
  m.config.mockResolvedValue(2); m.resolved.mockResolvedValue({ ok: true }); m.authorize.mockResolvedValue({ channelIds: ['channel'] });
  m.guard.mockImplementation((_id, run) => run());
});
it.each([null, 'https://attacker.example', 'invalid'])('rejects missing, foreign or malformed origin %s', async origin => {
  const response = await POST(request(input, origin)); expect(response.status).toBe(403); expect(m.viewer).not.toHaveBeenCalled(); expect(m.resolved).not.toHaveBeenCalled();
});
it('rejects unauthenticated calls before service dispatch', async () => {
  m.viewer.mockRejectedValue(new Error('private')); const response = await POST(request());
  expect(response.status).toBe(401); expect(m.authorize).not.toHaveBeenCalled(); expect(m.resolved).not.toHaveBeenCalled();
});
it('uses the current session workspace and the same service confirmation/deduplication as MCP', async () => {
  const response = await POST(request({ ...input, items: [...items, ...items] }));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(m.viewer).toHaveBeenCalledWith({ feature: 'inbox/conversations', channelScoped: true });
  expect(m.authorize).toHaveBeenCalledWith(actor, {}, 'write');
  expect(m.resolved).toHaveBeenCalledTimes(1);
  expect(m.resolved).toHaveBeenCalledWith(actor, { kind: 'comment', id: 'one', resolved: true }, {});
  expect(await response.json()).toMatchObject({ requested: 1, succeeded: 1, failed: 0 });
  expect(m.guard).not.toHaveBeenCalled();
});
it.each([
  { ...input, confirmation: 'BULK RESOLVE 2 INBOX ITEMS' },
  { ...input, confirmation: 'BULK RESOLVE 1 INBOX ITEMS ' },
  { ...input, action: 'unknown' }, { ...input, items: [] }, { ...input, workspaceId: 'other' },
  { ...input, items: [{ kind: 'comment', id: '../other' }] },
  { ...input, items: ['one', 'two', 'three'].map(id => ({ kind: 'comment', id })), confirmation: 'BULK RESOLVE 3 INBOX ITEMS' },
  { action: 'delete', items: [{ kind: 'message', id: 'one' }], confirmation: 'BULK DELETE 1 INBOX ITEMS' },
  '{',
])('rejects invalid payload or confirmation before any action: %j', async body => {
  const response = await POST(request(body)); expect(response.status).toBe(400); expect(m.resolved).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
});
it('rejects URL scope overrides', async () => {
  const response = await POST(request(input, 'https://app.example', '?workspaceId=other')); expect(response.status).toBe(400); expect(m.authorize).not.toHaveBeenCalled();
});
it('preserves a service-level write permission denial', async () => {
  m.authorize.mockRejectedValue(new OperationError('forbidden', 'Inbox access is unavailable in this workspace.'));
  const response = await POST(request()); expect(response.status).toBe(403); expect(m.resolved).not.toHaveBeenCalled();
});
it('preserves per-item resource scope failures without reporting a successful mutation', async () => {
  m.resolved.mockRejectedValue(new OperationError('unavailable', 'This item is unavailable in the current workspace.'));
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ succeeded: 0, failed: 1, results: [{ id: 'one', ok: false, code: 'unavailable' }] });
});
it('hides unexpected authorization backend errors', async () => {
  m.authorize.mockRejectedValue(new Error('private database password')); const response = await POST(request()); expect(response.status).toBe(502); expect(JSON.stringify(await response.json())).not.toContain('password');
});
