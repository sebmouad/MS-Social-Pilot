import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ actor: vi.fn(), viewer: vi.fn(), read: vi.fn(), change: vi.fn() }));
vi.mock('@/modules/settings/server/account-session', () => ({ accountSessionActor: m.actor }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example.test' }));
vi.mock('@/modules/settings/server/account-security', () => ({ readAccountSecurity: m.read, changeAccountSecurity: m.change }));
vi.mock('@/modules/settings/mcp-access/server', () => ({}));
vi.mock('@/modules/settings/person-keys/service', () => ({}));
vi.mock('@/modules/settings/server/account', () => ({}));
import { accountHttp } from '@/modules/settings/server/account-http';
import { ACCOUNT_MCP } from '@/modules/settings/account-mcp';
const actor = { userId: 'person', workspaceId: 'workspace', sessionTokenHash: 'hash' };
const viewer = { userId: 'person', user: { id: 'person' }, workspaceId: 'workspace' };
beforeEach(() => { vi.clearAllMocks(); m.actor.mockResolvedValue(actor); m.viewer.mockResolvedValue(viewer); m.read.mockResolvedValue({ passkeys: [], twoStepEnabled: false }); m.change.mockResolvedValue({ ok: true }); });
it.each([['begin', 'begin_account_two_step'], ['enable', 'enable_account_two_step'], ['disable', 'disable_account_two_step'], ['remove', 'remove_account_passkey']] as const)('REST and MCP share %s with the same actor, input and write policy', async (action, tool) => {
  const input = { currentPassword: 'private', confirmation: 'exact' };
  const request = new Request('https://app.example.test/api/settings/account/security', { method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const response = await accountHttp(request, action); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  await ACCOUNT_MCP.execute(viewer as never, tool, input, 5);
  expect(m.change.mock.calls).toEqual([[actor, action, input], [actor, action, input]]);
  expect(ACCOUNT_MCP.writeTools).toContain(tool); expect(ACCOUNT_MCP.selfLockedWrites).toContain(tool);
});
it('REST and MCP share credential metadata reads', async () => {
  await accountHttp(new Request('https://app.example.test/api/settings/account/security'), 'security');
  await ACCOUNT_MCP.execute(viewer as never, 'get_account_security', {}, 5);
  expect(m.read.mock.calls).toEqual([[actor], [actor]]);
});
it.each([{ origin: 'https://evil.example.test' }, {}, { origin: 'https://app.example.test', authorization: 'Bearer secret' }, { origin: 'https://app.example.test', 'x-api-key': 'secret' }])('refuses wrong-origin and bearer writes before invoking any service: %j', async headers => {
  const response = await accountHttp(new Request('https://app.example.test/api/settings/account/security', { method: 'POST', headers: headers as Record<string, string>, body: '{}' }), 'enable');
  expect(response.status).toBe(403); expect(m.change).not.toHaveBeenCalled(); expect(m.actor).not.toHaveBeenCalled();
});
it('does not expose security tools to bearer MCP and passes service failures through HTTP safely', async () => {
  await expect(ACCOUNT_MCP.execute({ ...viewer, apiKeyId: 'key' } as never, 'remove_account_passkey', {}, 5)).rejects.toMatchObject({ code: 'forbidden' });
  m.read.mockRejectedValueOnce(new Error('PRIVATE DATABASE ERROR')); const response = await accountHttp(new Request('https://app.example.test/api/settings/account/security'), 'security');
  expect(response.status).toBe(502); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE');
});
