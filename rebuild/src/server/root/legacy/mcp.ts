import { OperationError } from '@/lib/operation-error';
import type { RootMcpActor } from '@/server/mcp/types';
import { assignRootPlan, listRootPlanHistory, listRootPlans, listRootSubscribers, updateRootPlan } from './plans';
import { changeRootMemberRole, exportRootPrivileges, listRootPrivileges } from './privileges';
import { loadRootLifecycle, transferWorkspaceOwnership } from './lifecycle';
import { deleteRootWorkspace } from '../workspace-access';
import { deleteRootUser } from '../user-controls';
import { exportRootActivity } from '../audit-export';
import { transferInstallationOwnership } from './transfer';
import { getRootError, listRootErrors, setRootErrorResolved } from './errors';
import { readRootBackupStatus, readRootDiagnosticsSummary } from './backups';
import { listRootSessions, sessionSignOutConfirmation, signOutRootSession } from './sessions';
import { disconnectRootConnection, listRootConnections } from './connections';

const none = { type: 'object', properties: {}, additionalProperties: false } as const;
const privateNote = ' Installation owner only; workspace API keys cannot use this tool.';

/** Definitions for the host to merge into the Root MCP list. Not wired here. */
export const rootLegacyToolDefinitions = [
  { name: 'list_root_plans', description: 'Plan catalog with limits, features grouped by owning module, and subscriber counts.' + privateNote, inputSchema: none },
  { name: 'list_root_plan_history', description: 'Bounded plan edit and assignment audit history.' + privateNote, inputSchema: none },
  { name: 'list_root_subscribers', description: 'Bounded accounts that own a workspace, with their plan.' + privateNote, inputSchema: none },
  { name: 'update_root_plan', description: 'Edit a plan. patch holds changed fields only. Confirmation must exactly match UPDATE PLAN <key>, or SET DEFAULT PLAN <key> when making it the default. Default cannot be removed directly.' + privateNote, inputSchema: { type: 'object', required: ['planId', 'patch', 'confirmation'], properties: { planId: { type: 'string' }, patch: { type: 'object' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'assign_root_plan', description: 'Assign or clear (planKey null) an account plan. Confirmation must exactly match ASSIGN PLAN <key> TO <email> or REMOVE PLAN FROM <email>.' + privateNote, inputSchema: { type: 'object', required: ['userId', 'planKey', 'confirmation'], properties: { userId: { type: 'string' }, planKey: { type: ['string', 'null'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_root_privileges', description: 'Paged member, role and channel-scope audit across workspaces. Filters: q, role, workspaceId, page.' + privateNote, inputSchema: { type: 'object', properties: { q: { type: 'string' }, role: { type: 'string' }, workspaceId: { type: 'string' }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'export_root_privileges', description: 'Complete CSV of the privilege audit, bounded by Root. Oversized results are refused.' + privateNote, inputSchema: { type: 'object', properties: { q: { type: 'string' }, role: { type: 'string' }, workspaceId: { type: 'string' } }, additionalProperties: false } },
  { name: 'change_root_member_role', description: 'Change one member role in a workspace. Confirmation must exactly match CHANGE ROLE <email> IN <workspaceId> TO <role>. The last active owner cannot be demoted.' + privateNote, inputSchema: { type: 'object', required: ['membershipId', 'role', 'confirmation'], properties: { membershipId: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_root_lifecycle', description: 'Disabled accounts, suspended workspaces and queued deletions. Use delete_root_workspace for a suspended workspace; manage_root_user and set_root_workspace_access to change access.' + privateNote, inputSchema: none },
  { name: 'transfer_root_workspace_ownership', description: 'Make an active existing account the owner of a workspace. previousOwners keep or demote_admin. Confirmation must exactly match TRANSFER WORKSPACE <workspaceId> TO <email>. Does not transfer installation Root.' + privateNote, inputSchema: { type: 'object', required: ['workspaceId', 'newOwnerEmail', 'previousOwners', 'confirmation'], properties: { workspaceId: { type: 'string' }, newOwnerEmail: { type: 'string' }, previousOwners: { type: 'string', enum: ['keep', 'demote_admin'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'export_root_activity', description: 'Complete redacted Root audit CSV with workspace, inclusive UTC dates and literal search filters. Oversized results are refused.' + privateNote, inputSchema: { type: 'object', properties: { q: { type: 'string' }, workspaceId: { type: 'string' }, from: { type: 'string', description: 'Inclusive UTC YYYY-MM-DD' }, to: { type: 'string', description: 'Inclusive UTC YYYY-MM-DD' } }, additionalProperties: false } },
  { name: 'disconnect_root_connection', description: 'Disconnect one workspace connection: its stored credentials stop working and its channels and ad accounts are switched off; posts, messages and metrics are kept and nothing is revoked at the platform. Confirmation must exactly match DISCONNECT CONNECTION <socialAccountId>.' + privateNote, inputSchema: { type: 'object', required: ['socialAccountId', 'confirmation'], properties: { socialAccountId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'transfer_root_installation', description: 'Hand installation ownership (Root) to another active account; you lose Root. Confirmation must exactly match TRANSFER INSTALLATION TO <email>.' + privateNote, inputSchema: { type: 'object', required: ['email', 'confirmation'], properties: { email: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_root_user', description: 'Permanently delete a disabled account that is not Root and not the only owner of any workspace. Its posts and invitations stay, credited to you; API keys it created are revoked. Confirmation must exactly match DELETE ACCOUNT <email>.' + privateNote, inputSchema: { type: 'object', required: ['userId', 'confirmation'], properties: { userId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_root_workspace', description: 'Permanently delete a suspended workspace: all its posts, inbox, analytics, settings, members and stored media. Accounts are kept. Cannot be undone; take a backup first. Confirmation must exactly match DELETE WORKSPACE <workspaceId>. Provider content already published is not removed.' + privateNote, inputSchema: { type: 'object', required: ['workspaceId', 'confirmation'], properties: { workspaceId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_root_errors', description: 'Grouped application errors, redacted and truncated. Filters: status open|resolved|all, source server|worker|browser, q, page.' + privateNote, inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'resolved', 'all'] }, source: { type: 'string', enum: ['server', 'worker', 'browser'] }, q: { type: 'string' }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'get_root_error', description: 'One error group including a redacted, truncated stack.' + privateNote, inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_root_error_resolved', description: 'Resolve or reopen an error group (audited, reversible). Exact confirmation: RESOLVE ROOT ERROR <id> or REOPEN ROOT ERROR <id>.' + privateNote, inputSchema: { type: 'object', required: ['id', 'resolved', 'confirmation'], properties: { id: { type: 'string' }, resolved: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_root_backup_status', description: 'Backup and restore-test runs as recorded by the server scripts. Reports only recorded entries; does not verify archives, restore or run backups.' + privateNote, inputSchema: none },
  { name: 'get_root_diagnostics_summary', description: 'Open system alerts and error counts. Provider health is reported as not assessed; use run_root_diagnostics for module checks.' + privateNote, inputSchema: none },
  { name: 'list_root_sessions', description: 'Unexpired browser sessions across the installation with their account; no tokens. Filter: q (email or name). Bounded and labelled truncated.' + privateNote, inputSchema: { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false } },
  { name: 'sign_out_root_session', description: 'End one browser session (the account stays enabled). Confirmation must exactly match SIGN OUT SESSION <sessionId>. Audited.' + privateNote, inputSchema: { type: 'object', required: ['sessionId', 'confirmation'], properties: { sessionId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_root_connections', description: 'Read-only provider connections across every workspace: platform, workspace, state (connected|expired|revoked), token expiry, scope count and selected/discovered channels. No credentials. Filters: q, provider, state, page.' + privateNote, inputSchema: { type: 'object', properties: { q: { type: 'string' }, provider: { type: 'string' }, state: { type: 'string', enum: ['connected', 'expired', 'revoked'] }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
] as const;

export const rootLegacyResources = [
  { uri: 'msp://root/plans', name: 'Plans', description: 'Private plan catalog and subscriber counts.', mimeType: 'application/json', tool: 'list_root_plans' },
  { uri: 'msp://root/privileges', name: 'Privileges', description: 'Private first page of the member and role audit.', mimeType: 'application/json', tool: 'list_root_privileges' },
  { uri: 'msp://root/lifecycle', name: 'Account and workspace lifecycle', description: 'Private disabled accounts and suspended workspaces.', mimeType: 'application/json', tool: 'get_root_lifecycle' },
  { uri: 'msp://root/errors', name: 'Error log', description: 'Private open application errors, redacted.', mimeType: 'application/json', tool: 'list_root_errors' },
  { uri: 'msp://root/sessions', name: 'Sessions', description: 'Private unexpired browser sessions, without tokens.', mimeType: 'application/json', tool: 'list_root_sessions' },
  { uri: 'msp://root/connections', name: 'Connections', description: 'Private first page of provider connections across workspaces, without credentials.', mimeType: 'application/json', tool: 'list_root_connections' },
  { uri: 'msp://root/backups', name: 'Backup status', description: 'Private recorded backup runs; unverified archives.', mimeType: 'application/json', tool: 'get_root_backup_status' },
] as const;

export const rootLegacyTools = new Set<string>(rootLegacyToolDefinitions.map(tool => tool.name));
/** Root is the account itself, never an API key or workspace role. */
export const canUseRootLegacyTool = (viewer: RootMcpActor) => viewer.isInstanceOwner === true && !viewer.apiKeyId;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const reject = (extra: Record<string, unknown>) => { if (Object.keys(extra).length) throw new OperationError('invalid_request', 'This tool does not accept those arguments.'); };

export async function callRootLegacyTool(viewer: RootMcpActor, name: string, args: unknown) {
  if (!canUseRootLegacyTool(viewer)) throw new OperationError('forbidden', 'Installation-owner access is required.');
  if (!isRecord(args)) throw new OperationError('invalid_request', 'Tool arguments must be an object.');
  const id = viewer.userId;
  const cap = viewer.maxResultItems;
  switch (name) {
    case 'list_root_plans': reject(args); return listRootPlans(id, cap);
    case 'list_root_plan_history': reject(args); return listRootPlanHistory(id, cap);
    case 'list_root_subscribers': reject(args); return listRootSubscribers(id, cap);
    case 'update_root_plan': { const { planId, ...rest } = args; return updateRootPlan(id, typeof planId === 'string' ? planId : '', rest); }
    case 'assign_root_plan': return assignRootPlan(id, args);
    case 'list_root_privileges': return listRootPrivileges(id, args, cap);
    case 'export_root_privileges': return exportRootPrivileges(id, args, cap);
    case 'change_root_member_role': return changeRootMemberRole(id, args);
    case 'get_root_lifecycle': reject(args); return loadRootLifecycle(id, cap);
    case 'transfer_root_workspace_ownership': return transferWorkspaceOwnership(id, args);
    case 'export_root_activity': return exportRootActivity(id, args);
    case 'disconnect_root_connection': {
      const { socialAccountId, confirmation, ...extra } = args; reject(extra);
      if (typeof socialAccountId !== 'string' || typeof confirmation !== 'string') throw new OperationError('invalid_request', 'Choose a connection and enter the exact confirmation.');
      return disconnectRootConnection(id, socialAccountId, confirmation);
    }
    case 'transfer_root_installation': return transferInstallationOwnership(id, args);
    case 'delete_root_user': {
      const { userId, confirmation, ...extra } = args; reject(extra);
      if (typeof userId !== 'string' || typeof confirmation !== 'string' || userId.length > 200) throw new OperationError('invalid_request', 'Choose an account and enter the exact confirmation.');
      return deleteRootUser(id, userId, confirmation);
    }
    case 'delete_root_workspace': {
      const { workspaceId, confirmation, ...extra } = args; reject(extra);
      if (typeof workspaceId !== 'string' || typeof confirmation !== 'string' || workspaceId.length > 200) throw new OperationError('invalid_request', 'Choose a workspace and enter the exact confirmation.');
      return deleteRootWorkspace(id, workspaceId, confirmation);
    }
    case 'list_root_errors': return listRootErrors(id, args, cap);
    case 'get_root_error': { const { id: errorId, ...extra } = args; reject(extra); return getRootError(id, typeof errorId === 'string' ? errorId : ''); }
    case 'set_root_error_resolved': {
      const { id: errorId, resolved, confirmation, ...extra } = args; reject(extra);
      if (typeof errorId !== 'string' || typeof resolved !== 'boolean' || confirmation !== `${resolved ? 'RESOLVE' : 'REOPEN'} ROOT ERROR ${errorId}`) throw new OperationError('invalid_request', 'Enter the exact error action confirmation.');
      return setRootErrorResolved(id, errorId, resolved);
    }
    case 'get_root_backup_status': reject(args); return readRootBackupStatus(id, undefined, cap);
    case 'get_root_diagnostics_summary': reject(args); return readRootDiagnosticsSummary(id, undefined, cap);
    case 'list_root_sessions': return listRootSessions(id, args, cap);
    case 'sign_out_root_session': {
      const { sessionId, confirmation, ...extra } = args; reject(extra);
      if (typeof sessionId !== 'string' || confirmation !== sessionSignOutConfirmation(sessionId)) throw new OperationError('invalid_request', 'Enter the exact sign-out confirmation.');
      return signOutRootSession(id, sessionId, { confirmation });
    }
    case 'list_root_connections': return listRootConnections(id, args, cap);
    default: throw new OperationError('not_found', 'Unknown tool.');
  }
}
