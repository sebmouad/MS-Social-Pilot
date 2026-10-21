import { beforeEach, expect, it, vi } from 'vitest';
import { OperationError } from '@/lib/operation-error';
const m = vi.hoisted(() => ({ disconnect: vi.fn(), guard: vi.fn(), viewer: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example' }));
vi.mock('@/server/connection-mutations', () => ({ disconnectSocialAccount: m.disconnect, previewSocialAccountDeletion: vi.fn(), setConnectionSelections: vi.fn() }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: m.guard }));
import { changeConnectionDisconnect } from '@/modules/settings/server/connection-disconnect';
import { DELETE } from '@/app/api/connections/route';
const actor = { userId: 'user', workspaceId: 'workspace' };
const payload = (mode: 'retain' | 'delete') => ({ socialAccountId: 'source', mode, confirmation: `DISCONNECT source ${mode === 'retain' ? 'RETAIN' : 'DELETE RELATED DATA'}` });
const request = (input: unknown = payload('retain'), origin: string | null = 'https://app.example') => new Request('https://app.example/api/connections', { method: 'DELETE', headers: origin ? { origin } : {}, body: JSON.stringify(input) });
beforeEach(() => {
  vi.resetAllMocks(); m.guard.mockImplementation((_id, run) => run()); m.disconnect.mockResolvedValue({ mode: 'retain', stillScheduled: 0 }); m.viewer.mockResolvedValue({ user: { id: actor.userId }, workspaceId: actor.workspaceId });
});
it.each(['retain', 'delete'] as const)('HTTP and direct callers share exact named %s consent and the audited core', async mode => {
  m.disconnect.mockResolvedValue({ mode, stillScheduled: 0 });
  const direct = await changeConnectionDisconnect(actor, payload(mode));
  const response = await DELETE(request(payload(mode))); expect(response.status).toBe(200); expect(await response.json()).toEqual(direct);
  expect(direct).toMatchObject({ ok: true, socialAccountId: 'source', mode, providerAccessRevoked: false });
  expect(m.disconnect).toHaveBeenCalledTimes(2);
  for (const args of m.disconnect.mock.calls) expect(args).toEqual([actor, 'source', mode, mode === 'delete' ? 'DELETE' : undefined]);
  expect(m.guard).toHaveBeenCalledWith(actor.workspaceId, expect.any(Function));
  expect(m.viewer).toHaveBeenCalledWith({ feature: 'settings/connections' });
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it.each([
  { socialAccountId: 'source', mode: 'retain' },
  { ...payload('delete'), confirmation: 'DELETE' },
  { ...payload('delete'), confirmation: 'DISCONNECT source RETAIN' },
  { ...payload('retain'), confirmation: 'DISCONNECT other RETAIN' },
  { ...payload('retain'), confirmation: 'DISCONNECT source RETAIN ' },
  { ...payload('retain'), workspaceId: 'other' },
  { ...payload('retain'), mode: 'other' },
  { ...payload('retain'), socialAccountId: '../source' },
])('rejects unsafe consent or scope overrides in direct and HTTP calls %j', async input => {
  await expect(changeConnectionDisconnect(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
  expect((await DELETE(request(input))).status).toBe(400); expect(m.disconnect).not.toHaveBeenCalled(); expect(m.guard).not.toHaveBeenCalled();
});
it.each(['forbidden', 'unavailable', 'conflict'] as const)('preserves %s from current authorization, tenant checks or unsettled operations', async code => {
  m.disconnect.mockRejectedValue(new OperationError(code, 'Review this source.'));
  const response = await DELETE(request()); expect(response.status).toBe(code === 'forbidden' ? 403 : 409); expect(await response.json()).toEqual({ code, error: 'Review this source.' });
});
it('rejects anonymous calls', async () => {
  m.viewer.mockRejectedValue(new Error('private')); expect((await DELETE(request())).status).toBe(401); expect(m.disconnect).not.toHaveBeenCalled();
});
it.each([null, 'https://attacker.example'])('rejects unsafe origin %s', async origin => {
  expect((await DELETE(request(payload('retain'), origin))).status).toBe(403); expect(m.viewer).not.toHaveBeenCalled(); expect(m.disconnect).not.toHaveBeenCalled();
});
it('masks unexpected core failures', async () => {
  m.disconnect.mockRejectedValue(new Error('private password')); const response = await DELETE(request()); expect(response.status).toBe(502); expect(JSON.stringify(await response.json())).not.toContain('password');
});
