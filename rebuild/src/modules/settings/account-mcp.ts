import { readAccountSecurity, changeAccountSecurity } from './server/account-security';
import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { accountSessionActor } from './server/account-session';
import { readAccount, updateAccountProfile, changeAccountPassword, listAccountSessions, revokeAccountSession } from './server/account';
import { issueMcpKey, listMcpKeys, revokeMcpKey } from './mcp-access/server';
import { issuePersonKey, listPersonKeys, revokePersonKey } from './person-keys/service';
const string = { type: 'string' };
const confirmation = { confirmation: string };
const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
export const accountToolDefinitions = [
  tool('get_account_security', 'List authenticator status and passkey metadata. Browser sessions only.'),
  tool('begin_account_two_step', 'Start authenticator setup. Confirmation: SET UP ACCOUNT TWO STEP. Browser sessions only.', { currentPassword: string, code: string, id: string, ...confirmation }, ['currentPassword', 'confirmation']),
  tool('enable_account_two_step', 'Verify authenticator and return recovery codes once. Confirmation: ENABLE ACCOUNT TWO STEP. Browser sessions only.', { currentPassword: string, code: string, id: string, ...confirmation }, ['currentPassword', 'code', 'confirmation']),
  tool('disable_account_two_step', 'Disable authenticator with a fresh verification code. Confirmation: DISABLE ACCOUNT TWO STEP. Browser sessions only.', { currentPassword: string, code: string, id: string, ...confirmation }, ['currentPassword', 'code', 'confirmation']),
  tool('remove_account_passkey', 'Remove your passkey. Confirmation: REMOVE ACCOUNT PASSKEY <id>. Browser sessions only.', { currentPassword: string, code: string, id: string, ...confirmation }, ['currentPassword', 'id', 'confirmation']),
  tool('get_account', 'Read your profile and validation policy. Browser sessions only.'),
  tool('update_account_profile', 'Update your name. Confirmation: UPDATE ACCOUNT PROFILE. Browser sessions only.', { name: string, ...confirmation }, ['name', 'confirmation']),
  tool('change_account_password', 'Change password and revoke other sessions. Passwords are never audited. Confirmation: CHANGE ACCOUNT PASSWORD. Browser sessions only.', { currentPassword: string, newPassword: string, ...confirmation }, ['currentPassword', 'newPassword', 'confirmation']),
  tool('list_account_sessions', 'Read active sessions. Continue with nextOffset. Browser sessions only.', { offset: { type: 'integer', minimum: 0 } }),
  tool('revoke_account_session', 'Revoke another session. Confirmation: REVOKE ACCOUNT SESSION <id>. Browser sessions only.', { id: string, ...confirmation }, ['id', 'confirmation']),
  tool('list_mcp_keys', 'Read workspace key metadata without secrets. Continue with nextOffset. Browser sessions only.', { offset: { type: 'integer', minimum: 0 } }),
  tool('create_mcp_key', 'Issue a key with explicit permissions and resources; secret returned once. Confirmation: CREATE MCP KEY <name>. Browser sessions only.', { name: string, readFeatures: { type: 'array', items: string }, writeFeatures: { type: 'array', items: string }, expiresInDays: { type: 'integer', minimum: 1 }, resourceScope: { type: 'object' }, ...confirmation }, ['name', 'readFeatures', 'writeFeatures', 'expiresInDays', 'resourceScope', 'confirmation']),
  tool('revoke_mcp_key', 'Revoke workspace key. Confirmation: REVOKE MCP KEY <id>. Browser sessions only.', { id: string, ...confirmation }, ['id', 'confirmation']),
  tool('list_person_mcp_keys', 'List your active Agency credentials. Browser sessions only.'),
  tool('create_person_mcp_key', 'Issue read-only Agency overview key. Confirmation: CREATE AGENCY KEY <name> <expiresInDays> DAYS. Browser sessions only.', { name: string, expiresInDays: { type: 'integer', minimum: 1 }, ...confirmation }, ['name', 'expiresInDays', 'confirmation']),
  tool('revoke_person_mcp_key', 'Revoke Agency key. Confirmation: REVOKE AGENCY KEY <id>. Browser sessions only.', { id: string, ...confirmation }, ['id', 'confirmation']),
];
const writes = ['begin_account_two_step', 'enable_account_two_step', 'disable_account_two_step', 'remove_account_passkey', 'update_account_profile', 'change_account_password', 'revoke_account_session', 'create_mcp_key', 'revoke_mcp_key', 'create_person_mcp_key', 'revoke_person_mcp_key'];
export const ACCOUNT_MCP: McpToolGroup = {
  id: 'settings-account-access', tools: accountToolDefinitions,
  features: Object.fromEntries(accountToolDefinitions.map(tool => [tool.name, ['list_mcp_keys', 'create_mcp_key', 'revoke_mcp_key'].includes(tool.name) ? 'settings/mcp' : 'settings/account'])),
  writeTools: writes, selfLockedWrites: writes,
  scope: { workspaceTools: accountToolDefinitions.map(tool => tool.name) },
  available: async viewer => () => !viewer.apiKeyId,
  beforeCall: viewer => { if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session to manage account access.'); },
  execute: async (viewer, name, args, cap) => {
    if (viewer.apiKeyId) throw new OperationError('forbidden', 'Use a signed-in browser session to manage account access.');
    const actor = await accountSessionActor(viewer.userId, viewer.workspaceId);
    switch (name) {
      case 'get_account_security': return readAccountSecurity(actor);
      case 'begin_account_two_step': return changeAccountSecurity(actor, 'begin', args);
      case 'enable_account_two_step': return changeAccountSecurity(actor, 'enable', args);
      case 'disable_account_two_step': return changeAccountSecurity(actor, 'disable', args);
      case 'remove_account_passkey': return changeAccountSecurity(actor, 'remove', args);
      case 'get_account': return readAccount(actor);
      case 'update_account_profile': return updateAccountProfile(actor, args);
      case 'change_account_password': return changeAccountPassword(actor, args);
      case 'list_account_sessions': return listAccountSessions(actor, args, cap);
      case 'revoke_account_session': return revokeAccountSession(actor, args);
      case 'list_mcp_keys': return listMcpKeys(actor, args, cap);
      case 'create_mcp_key': return issueMcpKey(actor, args);
      case 'revoke_mcp_key': return revokeMcpKey(actor, args);
      case 'list_person_mcp_keys': return listPersonKeys(actor);
      case 'create_person_mcp_key': return issuePersonKey(actor, args);
      case 'revoke_person_mcp_key': return revokePersonKey(actor, args);
      default: throw new OperationError('invalid_request', 'Unknown account action.');
    }
  },
};
