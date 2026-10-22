import { synchronousPolicy, withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { z } from 'zod';
import { refreshRootConnection } from './connection-refresh';
import { revokeTeamInvitationConfirmation } from '@/modules/settings/invitations';
import { listRootRegistration, revokeRootRegistrationInvitation, controlRootRegistrationAccount, registrationConfirmation } from '@/server/root/registration-admin';
import { OperationError } from '@/lib/operation-error';
import type { RootMcpActor } from '@/server/mcp/types';
import { assignRootPlan, listRootPlanHistory, listRootPlans, listRootSubscribers, updateRootPlan } from './plans';
import { changeRootMemberRole, exportRootPrivileges, listRootPrivileges } from './privileges';
import { loadRootLifecycle, transferWorkspaceOwnership } from './lifecycle';
import { deleteRootWorkspace } from '@/server/root/workspace-access';
import { deleteRootUser } from '@/server/root/user-controls';
import { exportRootActivity } from '@/server/root/audit-export';
import { transferInstallationOwnership } from './transfer';
import { getRootError, listRootErrors, setRootErrorResolved } from './errors';
import { readRootBackupStatus, readRootDiagnosticsSummary } from './backups';
import { listRootSessions, sessionSignOutConfirmation, signOutRootSession } from './sessions';
import { disconnectRootConnection, listRootConnections, previewRootConnectionDeletion } from './connections';

const none = { type: 'object', properties: {}, additionalProperties: false } as const;
const privateNote = ' Installation owner only; workspace API keys cannot use this tool.';

const registrationId = z.string().min(1).regex(/^[^\u0000-\u001f\u007f]+$/).refine(withinSynchronousLimit('root.registrationIdentifierMaxCharacters'));
const registrationWrite = z.object({ userId: registrationId, confirmation: z.string().refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict();
const registrationRevoke = z.object({ workspaceId: registrationId, invitationId: registrationId, confirmation: z.string().refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict();
const idProperty = { type: 'string', minLength: 1 } as const;
const confirmationProperty = { type: 'string' } as const;

/** Definitions merged automatically into the private installation MCP host. */
export const rootAdminToolDefinitions = [
  { name: 'list_root_registration', description: 'Inspect read-only open-registration status, workspace invitations and eligible unverified self-registrations installation-wide. Invitation filters workspaceId and status do not filter accounts; q searches both. Independently paged and capped by Root and MCP limits; no total is inferred.' + privateNote, annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { q: { type: 'string' }, workspaceId: idProperty, status: { type: 'string', enum: ['pending', 'expired', 'accepted'] }, page: { type: 'integer', minimum: 1 }, accountsPage: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'revoke_root_invitation', description: 'Revoke an unaccepted invitation in the exact workspace; its link stops working. Confirmation must exactly match REVOKE INVITATION <invitationId>.' + privateNote, annotations: { readOnlyHint: false, destructiveHint: true }, inputSchema: { type: 'object', required: ['workspaceId', 'invitationId', 'confirmation'], properties: { workspaceId: idProperty, invitationId: idProperty, confirmation: confirmationProperty }, additionalProperties: false } },
  { name: 'resend_root_registration_verification', description: 'Replace the verification link and send mail for an eligible active self-registration. Requires open registration and working mail. Only delivery sent confirms submission; inspect mail/account state before retrying an uncertain outcome. Confirmation must exactly match RESEND VERIFICATION <userId>.' + privateNote, annotations: { readOnlyHint: false, destructiveHint: true }, inputSchema: { type: 'object', required: ['userId', 'confirmation'], properties: { userId: idProperty, confirmation: confirmationProperty }, additionalProperties: false } },
  { name: 'delete_root_unverified_registration', description: 'Permanently delete an eligible unverified non-Root self-registration without memberships and its personal authentication data. Confirmation must exactly match DELETE UNVERIFIED ACCOUNT <userId>.' + privateNote, annotations: { readOnlyHint: false, destructiveHint: true }, inputSchema: { type: 'object', required: ['userId', 'confirmation'], properties: { userId: idProperty, confirmation: confirmationProperty }, additionalProperties: false } },
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
  { name: 'refresh_root_connection', description: 'Attempt token renewal using the installed platform module. Returns renewed, not_renewable or failed with audit, without credentials. Confirmation must exactly match REFRESH CONNECTION <socialAccountId>.' + privateNote, annotations: { readOnlyHint: false }, inputSchema: { type: 'object', required: ['socialAccountId', 'confirmation'], properties: { socialAccountId: { type: 'string', minLength: 1 }, confirmation: confirmationProperty }, additionalProperties: false } },
  { name: 'preview_root_connection_deletion', description: 'Read-only estimate of the local records that disconnect_root_connection with mode delete would remove (channels, ad accounts, posts, comments, conversations, metrics). Changes nothing and contacts no platform.' + privateNote, annotations: { readOnlyHint: true }, inputSchema: { type: 'object', required: ['socialAccountId'], properties: { socialAccountId: { type: 'string', minLength: 1 } }, additionalProperties: false } },
  { name: 'disconnect_root_connection', description: 'Disconnect one workspace connection. mode retain (default): stored credentials stop working and its channels and ad accounts are switched off; posts, messages and metrics are kept. mode delete: also permanently removes the related local records (see preview_root_connection_deletion); refused while posts are still scheduled at the platform. Nothing is revoked at the platform in either mode. Confirmation must exactly match DISCONNECT CONNECTION <socialAccountId> (retain) or DELETE CONNECTION DATA <socialAccountId> (delete).' + privateNote, inputSchema: { type: 'object', required: ['socialAccountId', 'confirmation'], properties: { socialAccountId: { type: 'string' }, confirmation: { type: 'string' }, mode: { type: 'string', enum: ['retain', 'delete'] } }, additionalProperties: false } },
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

export const rootAdminResources = [
  { uri: 'msp://root/plans', name: 'Plans', description: 'Private plan catalog and subscriber counts.', mimeType: 'application/json', tool: 'list_root_plans' },
  { uri: 'msp://root/privileges', name: 'Privileges', description: 'Private first page of the member and role audit.', mimeType: 'application/json', tool: 'list_root_privileges' },
  { uri: 'msp://root/lifecycle', name: 'Account and workspace lifecycle', description: 'Private disabled accounts and suspended workspaces.', mimeType: 'application/json', tool: 'get_root_lifecycle' },
  { uri: 'msp://root/errors', name: 'Error log', description: 'Private open application errors, redacted.', mimeType: 'application/json', tool: 'list_root_errors' },
  { uri: 'msp://root/sessions', name: 'Sessions', description: 'Private unexpired browser sessions, without tokens.', mimeType: 'application/json', tool: 'list_root_sessions' },
  { uri: 'msp://root/connections', name: 'Connections', description: 'Private first page of provider connections across workspaces, without credentials.', mimeType: 'application/json', tool: 'list_root_connections' },
  { uri: 'msp://root/backups', name: 'Backup status', description: 'Private recorded backup runs; unverified archives.', mimeType: 'application/json', tool: 'get_root_backup_status' },
] as const;

export const rootAdminTools = new Set<string>(rootAdminToolDefinitions.map(tool => tool.name));
/** Root is the account itself, never an API key or workspace role. */
export const canUseRootAdminTool = (viewer: RootMcpActor) => viewer.isInstanceOwner === true && !viewer.apiKeyId;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const reject = (extra: Record<string, unknown>) => { if (Object.keys(extra).length) throw new OperationError('invalid_request', 'This tool does not accept those arguments.'); };

export async function callRootAdminTool(viewer: RootMcpActor, name: string, args: unknown) {
  if (!canUseRootAdminTool(viewer)) throw new OperationError('forbidden', 'Installation-owner access is required.');
  if (!isRecord(args)) throw new OperationError('invalid_request', 'Tool arguments must be an object.');
  const id = viewer.userId;
  const cap = viewer.maxResultItems;
  switch (name) {
    case 'list_root_registration': return listRootRegistration(id, args, cap);
    case 'revoke_root_invitation': {
      const parsed = registrationRevoke.safeParse(args);
      if (!parsed.success || parsed.data.confirmation !== revokeTeamInvitationConfirmation(parsed.data.invitationId)) throw new OperationError('invalid_request', 'Enter the exact invitation confirmation shown.');
      const { workspaceId, invitationId, confirmation } = parsed.data;
      return revokeRootRegistrationInvitation(id, workspaceId, invitationId, { confirmation });
    }
    case 'resend_root_registration_verification':
    case 'delete_root_unverified_registration': {
      const action = name === 'resend_root_registration_verification' ? 'resend' : 'delete';
      const parsed = registrationWrite.safeParse(args);
      if (!parsed.success || parsed.data.confirmation !== registrationConfirmation(action, parsed.data.userId)) throw new OperationError('invalid_request', 'Enter the exact account confirmation shown.');
      return controlRootRegistrationAccount(id, parsed.data.userId, action, { confirmation: parsed.data.confirmation });
    }
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
    case 'refresh_root_connection': return refreshRootConnection(id, args);
    case 'preview_root_connection_deletion': {
      const { socialAccountId, ...extra } = args; reject(extra);
      if (typeof socialAccountId !== 'string') throw new OperationError('invalid_request', 'Choose a connection.');
      return previewRootConnectionDeletion(id, socialAccountId);
    }
    case 'disconnect_root_connection': {
      const { socialAccountId, confirmation, mode, ...extra } = args; reject(extra);
      if (typeof socialAccountId !== 'string' || typeof confirmation !== 'string' || (mode !== undefined && mode !== 'retain' && mode !== 'delete')) throw new OperationError('invalid_request', 'Choose a connection, retain or delete, and enter the exact confirmation.');
      return disconnectRootConnection(id, socialAccountId, confirmation, mode);
    }
    case 'transfer_root_installation': return transferInstallationOwnership(id, args);
    case 'delete_root_user': {
      const { userId, confirmation, ...extra } = args; reject(extra);
      if (typeof userId !== 'string' || typeof confirmation !== 'string' || userId.length > synchronousPolicy('root.identifierMaxCharacters')) throw new OperationError('invalid_request', 'Choose an account and enter the exact confirmation.');
      return deleteRootUser(id, userId, confirmation);
    }
    case 'delete_root_workspace': {
      const { workspaceId, confirmation, ...extra } = args; reject(extra);
      if (typeof workspaceId !== 'string' || typeof confirmation !== 'string' || workspaceId.length > synchronousPolicy('root.identifierMaxCharacters')) throw new OperationError('invalid_request', 'Choose a workspace and enter the exact confirmation.');
      return deleteRootWorkspace(id, workspaceId, confirmation);
    }
    case 'list_root_errors': return listRootErrors(id, args, cap);
    case 'get_root_error': { const { id: errorId, ...extra } = args; reject(extra); return getRootError(id, typeof errorId === 'string' ? errorId : ''); }
    case 'set_root_error_resolved': {
      const { id: errorId, resolved, confirmation, ...extra } = args; reject(extra);
      if (typeof errorId !== 'string' || typeof resolved !== 'boolean' || typeof confirmation !== 'string') throw new OperationError('invalid_request', 'Enter the exact error action confirmation.');
      return setRootErrorResolved(id, errorId, resolved, confirmation);
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
