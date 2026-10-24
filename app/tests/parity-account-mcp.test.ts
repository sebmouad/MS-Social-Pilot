import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ actor: vi.fn(), readAccount: vi.fn(), updateAccountProfile: vi.fn(), changeAccountPassword: vi.fn(), listAccountSessions: vi.fn(), revokeAccountSession: vi.fn(), issueMcpKey: vi.fn(), listMcpKeys: vi.fn(), revokeMcpKey: vi.fn(), issuePersonKey: vi.fn(), listPersonKeys: vi.fn(), revokePersonKey: vi.fn() }));
vi.mock('@/modules/settings/server/account-session', () => ({ accountSessionActor: m.actor }));
vi.mock('@/modules/settings/server/account', () => m);
vi.mock('@/modules/settings/mcp-access/server', () => m);
vi.mock('@/modules/settings/person-keys/service', () => m);
import { ACCOUNT_MCP } from '@/modules/settings/account-mcp';
const viewer = { userId: 'user', workspaceId: 'workspace' } as never;
const actor = { userId: 'user', workspaceId: 'workspace', sessionTokenHash: 'hash' };
beforeEach(() => { vi.clearAllMocks(); m.actor.mockResolvedValue(actor); });
it('hides and refuses all account and credential tools for workspace bearer keys', async () => {
  const key = { userId: 'user', workspaceId: 'workspace', apiKeyId: 'key' } as never;
  const available = await ACCOUNT_MCP.available!(key);
  for (const tool of ACCOUNT_MCP.tools) {
    expect(available(tool.name)).toBe(false);
    await expect(ACCOUNT_MCP.execute(key, tool.name, {}, 5)).rejects.toMatchObject({ code: 'forbidden' });
  }
  expect(m.actor).not.toHaveBeenCalled(); expect(m.issueMcpKey).not.toHaveBeenCalled();
});
it.each([
  ['get_account', 'readAccount'], ['update_account_profile', 'updateAccountProfile'], ['change_account_password', 'changeAccountPassword'],
  ['list_account_sessions', 'listAccountSessions'], ['revoke_account_session', 'revokeAccountSession'], ['list_mcp_keys', 'listMcpKeys'],
  ['create_mcp_key', 'issueMcpKey'], ['revoke_mcp_key', 'revokeMcpKey'], ['list_person_mcp_keys', 'listPersonKeys'],
  ['create_person_mcp_key', 'issuePersonKey'], ['revoke_person_mcp_key', 'revokePersonKey'],
])('dispatches %s through the shared service with session authority', async (tool, service) => {
  const args = { confirmation: 'reviewed' };
  await ACCOUNT_MCP.execute(viewer, tool, args, 5);
  const fn = m[service as keyof typeof m];
  expect(fn).toHaveBeenCalled(); expect(fn.mock.calls[0]![0]).toEqual(actor);
  if (['list_account_sessions', 'list_mcp_keys'].includes(tool)) expect(fn.mock.calls[0]![2]).toBe(5);
});
it('declares confirmation requirements on every write', () => {
  for (const name of ACCOUNT_MCP.writeTools!) expect(ACCOUNT_MCP.tools.find(t => t.name === name)?.inputSchema.required).toContain('confirmation');
});
