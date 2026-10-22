import { changeConnectionSelections } from './server/connection-selection';
import { exportWorkspaceArchive } from '@/server/data-control/archive';
import { ACCOUNT_MCP } from './account-mcp';
import { ACCOUNT_EXPORT_MCP } from './server/account-export-mcp';
import { SESSION_PARITY_MCP } from './session-parity-mcp';
import { CONNECTION_START_MCP } from './connection-start-mcp';
import { AGENCY_SESSION_MCP } from '@/modules/agency/mcp';
import { CHANNEL_PROFILES_MCP } from './channel-profiles/mcp';
import { WATERMARK_MCP } from './watermark/mcp';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { canUseFeature, entitledPlatformIds, requireFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { publishingTargetChoices } from '@/modules/publishing/server/destinations';
import { deleteWorkspaceData, exportWorkspaceData, previewWorkspaceDataDeletion } from '@/server/data-control';
import { RUN_RETENTION_CONFIRMATION, getRetentionStatus, runRetentionNow } from './server/retention';
import { auditedReceipt, canManageData, pageIdsFor, requireConfirmation, type McpToolGroup } from '@/server/mcp/kit';
import { teamToolDefinitions, teamTools, executeTeamTool, invitationAvailability } from './team-mcp';
import { workspacePolicyToolDefinitions, workspacePolicyTools, executeWorkspacePolicyTool } from './workspace-policy-mcp';
import { notificationToolDefinitions, executeNotificationTool } from './notifications/mcp';
import { WORKSPACE_EXPORT_MCP } from './export-mcp';
import { connectionDirectoryFeatures, connectionDirectoryToolDefinitions, connectionDirectoryTools, executeConnectionDirectoryTool } from './connections-mcp';


/** MCP tool groups this module installs. The host merges installed groups; edit only here. */
export const SETTINGS_MCP: readonly McpToolGroup[] = [
  SESSION_PARITY_MCP,
  CONNECTION_START_MCP,
  AGENCY_SESSION_MCP,
  ACCOUNT_MCP,
  ACCOUNT_EXPORT_MCP,
  WORKSPACE_EXPORT_MCP,
  CHANNEL_PROFILES_MCP,
  WATERMARK_MCP,
  {
    id: 'settings-team',
    tools: teamToolDefinitions,
    features: {
      list_workspace_invitations: 'settings/team',
      invite_workspace_member: 'settings/team',
      revoke_workspace_invitation: 'settings/team',
      list_workspace_team: 'settings/team',
      add_workspace_member: 'settings/team',
      update_workspace_member: 'settings/team',
      remove_workspace_member: 'settings/team',
    },
    writeTools: ['invite_workspace_member', 'revoke_workspace_invitation', 'add_workspace_member', 'update_workspace_member', 'remove_workspace_member'],
    selfLockedWrites: ['invite_workspace_member', 'revoke_workspace_invitation', 'add_workspace_member', 'update_workspace_member', 'remove_workspace_member'],
    scope: { workspaceTools: ['list_workspace_invitations', 'invite_workspace_member', 'revoke_workspace_invitation', 'list_workspace_team', 'add_workspace_member', 'update_workspace_member', 'remove_workspace_member'] },
    managers: [{ tools: teamTools, message: 'Only workspace owners and admins can manage the team.', hideFromList: true, beforeArguments: true, inExecutor: true }],
    listFilter: async viewer => {
      const invitationsReady = canManageData(viewer) && canUseFeature(viewer.entitlements, 'settings/team') ? await invitationAvailability() : false;
      return name => name !== 'invite_workspace_member' || invitationsReady;
    },
    resources: [
      { uri: 'msp://settings/invitations', name: "Workspace invitations", description: "Bounded workspace invitations without raw links or credentials.", mimeType: 'application/json', feature: 'settings/team', readTool: 'list_workspace_invitations', managerOnly: true },
      { uri: 'msp://settings/team', name: "Workspace team", description: "Bounded member and assignable-channel directory. Continue pages with list_workspace_team.", mimeType: 'application/json', feature: 'settings/team', readTool: 'list_workspace_team', managerOnly: true },
    ],
    execute: (viewer, name, args, cap) => executeTeamTool({ userId: viewer.userId, workspaceId: viewer.workspaceId }, name, args, cap),
  },
  {
    id: 'settings-workspace',
    tools: workspacePolicyToolDefinitions,
    features: {
      get_workspace_policies: 'settings/workspace',
      update_workspace_policies: 'settings/workspace',
      get_workspace_operations: 'settings/workspace',
      update_workspace_operations: 'settings/workspace',
    },
    writeTools: ['update_workspace_policies', 'update_workspace_operations'],
    selfLockedWrites: ['update_workspace_policies', 'update_workspace_operations'],
    scope: { workspaceTools: ['get_workspace_policies', 'update_workspace_policies', 'get_workspace_operations', 'update_workspace_operations'] },
    managers: [{ tools: workspacePolicyTools, message: 'Only workspace owners and admins can manage workspace policies.', inExecutor: true }],
    resources: [
      { uri: 'msp://settings/policies', name: "Workspace publishing policies", description: "Current workspace time zone and contributor review policy; managers only.", mimeType: 'application/json', feature: 'settings/workspace', readTool: 'get_workspace_policies', managerOnly: true },
    ],
    execute: (viewer, name, args) => executeWorkspacePolicyTool({ userId: viewer.userId, workspaceId: viewer.workspaceId }, name, args),
  },
  {
    id: 'settings-notifications',
    tools: notificationToolDefinitions,
    features: {
      get_notification_preferences: 'settings/notifications',
      update_notification_preferences: 'settings/notifications',
      list_notifications: 'settings/notifications',
      mark_notification_read: 'settings/notifications',
      delete_notification: 'settings/notifications',
    },
    writeTools: ['update_notification_preferences', 'mark_notification_read', 'delete_notification'],
    selfLockedWrites: ['update_notification_preferences', 'mark_notification_read', 'delete_notification'],
    scope: { workspaceTools: ['get_notification_preferences', 'update_notification_preferences', 'list_notifications', 'mark_notification_read', 'delete_notification'] },
    beforeCall: (viewer, _name, isWrite) => {
      if (!canUseFeature(viewer.entitlements, 'settings/notifications') || !viewer.permissions || !canAccessFeature(viewer.permissions, 'settings/notifications', isWrite ? 'write' : 'read')) throw new OperationError('forbidden', 'Notifications are unavailable in this workspace.');
    },
    resources: [
      { uri: 'msp://notifications', name: "Notifications", description: "Your bounded notifications and email delivery state in the current workspace.", mimeType: 'application/json', feature: 'settings/notifications', readTool: 'list_notifications', readArgs: { page: 1 }, guardedRead: true },
    ],
    execute: (viewer, name, args) => executeNotificationTool({ userId: viewer.userId, workspaceId: viewer.workspaceId }, name, args),
  },
  {
    id: 'settings-connections',
    tools: [
    { name: 'list_pages', description: 'List enabled workspace destinations and their publishing availability.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'set_connection_selections', description: 'Atomically change multiple channel/ad-account selections, just like the Connections modal. Confirmation: SET CONNECTION SELECTIONS <number of items>. Current workspace manager authority is rechecked by the shared service.', inputSchema: { type: 'object', required: ['items', 'confirmation'], properties: { items: { type: 'array', minItems: 1, items: { type: 'object', required: ['kind', 'id', 'enabled'], properties: { kind: { type: 'string', enum: ['target', 'adAccount'] }, id: { type: 'string' }, enabled: { type: 'boolean' } }, additionalProperties: false } }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'set_connection_selection', description: 'Enable or disable one workspace channel or advertising account. Confirmation must exactly identify the selection and action.', inputSchema: { type: 'object', required: ['kind', 'id', 'enabled', 'confirmation'], properties: { kind: { type: 'string', enum: ['target', 'adAccount'] }, id: { type: 'string' }, enabled: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    ...connectionDirectoryToolDefinitions,
    ],
    features: {
      list_pages: 'settings/connections',
      set_connection_selections: 'settings/connections',
      set_connection_selection: 'settings/connections',
      ...connectionDirectoryFeatures,
    },
    writeTools: ['set_connection_selection', 'set_connection_selections', 'disconnect_connection'],
    scope: { resourceTools: ['list_pages'], workspaceTools: ['set_connection_selection', 'set_connection_selections', ...connectionDirectoryTools], resources: ['msp://targets'] },
    managers: [{ tools: new Set(['set_connection_selection', 'set_connection_selections', ...connectionDirectoryTools]), message: 'Only workspace owners and admins can change connections.', hideFromList: true, beforeArguments: true, inExecutor: true }],
    resources: [
      { uri: 'msp://targets', name: "Destinations", description: "Enabled workspace destinations.", mimeType: 'application/json', feature: 'settings/connections', readTool: 'list_pages' },
    ],
    execute: async (viewer, name, args, cap) => {
      switch (name) {
      case 'list_pages': {
        const pageIds = pageIdsFor(viewer);
        const targets = await prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, socialAccount: { is: await selectedResourceConnectionWhere(viewer.workspaceId, entitledPlatformIds(viewer.entitlements)) }, ...(pageIds ? { id: { in: pageIds } } : {}) }, orderBy: [{ type: 'asc' }, { name: 'asc' }], take: cap, select: { id: true, type: true, providerId: true, name: true, pictureUrl: true, canPublish: true } });
        const choices = await publishingTargetChoices(viewer.workspaceId, viewer.entitlements, targets.map(target => target.id));
        const ready = new Map(choices.map(choice => [choice.id, choice]));
        return targets.map(target => {
          const choice = ready.get(target.id);
          return { ...target, canPublish: choice?.canPublish === true,
            ...(choice?.canPublish && choice.publishingFormats ? { publishingFormats: choice.publishingFormats, defaultPublishingFormatId: choice.defaultPublishingFormatId } : {}),
            ...(choice?.canPublish && choice.publishingMedia ? { publishingMedia: choice.publishingMedia } : {}),
            ...(choice?.canPublish && choice.localImageUpload ? { localImageUpload: choice.localImageUpload } : {}),
          };
        });
      }
      case 'list_connections': case 'preview_connection_disconnect': case 'disconnect_connection':
        requireFeature(viewer.entitlements, 'settings/connections');
        return executeConnectionDirectoryTool(viewer, name, args, cap);
      case 'set_connection_selections':
        return changeConnectionSelections({ userId: viewer.userId, workspaceId: viewer.workspaceId }, args);
      case 'set_connection_selection':
        requireFeature(viewer.entitlements, 'settings/connections');
        await changeConnectionSelections({ userId: viewer.userId, workspaceId: viewer.workspaceId }, args);
        return auditedReceipt(viewer, name, { kind: args.kind, id: args.id, enabled: args.enabled }, { kind: args.kind, id: args.id, enabled: args.enabled });
        default: throw new OperationError('invalid_request', `Unknown tool: ${name}`);
      }
    },
  },
  {
    id: 'settings-data',
    tools: [
    { name: 'preview_workspace_data_deletion', description: 'Count workspace records that a data deletion would remove. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'export_workspace_archive', description: 'Download the same bounded workspace ZIP archive as Settings Data. Includes the archive service coverage and media; current workspace owner/admin access is rechecked. Returned as base64.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'export_workspace_data', description: 'Export the current workspace JSON snapshot, including directly workspace-owned legacy tables with credential fields redacted. Indirect records and media bytes are not included. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'delete_workspace_data', description: 'Delete workspace records and stored files while retaining workspace identity and members. A failed file cleanup can be retried. Confirmation must exactly match DELETE WORKSPACE DATA <workspaceId>. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'get_retention_status', description: 'Show the old-records cleanup policy, rows of this workspace already past it, and the last nightly run. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'prune_old_records', description: 'Remove this workspace’s old records now (activity trail, email log, click details, AI history, finished report runs). Installation history stays for the nightly run. Confirmation must exactly match PRUNE OLD RECORDS. Only workspace owners and admins may use this tool.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string' } }, additionalProperties: false } },
    ],
    features: {
      preview_workspace_data_deletion: 'settings/data',
      export_workspace_archive: 'settings/data',
      export_workspace_data: 'settings/data',
      delete_workspace_data: 'settings/data',
      get_retention_status: 'settings/data',
      prune_old_records: 'settings/data',
    },
    writeTools: ['delete_workspace_data', 'prune_old_records'],
    selfLockedWrites: ['delete_workspace_data', 'prune_old_records'],
    scope: { workspaceTools: ['preview_workspace_data_deletion', 'export_workspace_data', 'export_workspace_archive', 'delete_workspace_data', 'get_retention_status', 'prune_old_records'] },
    managers: [{ tools: new Set(['preview_workspace_data_deletion', 'export_workspace_data', 'export_workspace_archive', 'delete_workspace_data', 'get_retention_status', 'prune_old_records']), message: 'Only workspace owners and admins can manage workspace data.', hideFromList: true, inExecutor: true }],
    purgeCheckExempt: ['delete_workspace_data'],
    resources: [
      { uri: 'msp://data/deletion-preview', name: "Data deletion preview", description: "Current workspace record counts before deletion.", mimeType: 'application/json', feature: 'settings/data', readTool: 'preview_workspace_data_deletion', managerOnly: true, guardedRead: true },
    ],
    execute: async (viewer, name, args, cap) => {
      switch (name) {
      case 'preview_workspace_data_deletion':
        return previewWorkspaceDataDeletion({ userId: viewer.userId, workspaceId: viewer.workspaceId });
      case 'export_workspace_archive': {
        const content = await exportWorkspaceArchive({ userId: viewer.userId, workspaceId: viewer.workspaceId });
        return { mimeType: 'application/zip', byteLength: content.length, contentBase64: content.toString('base64') };
      }
      case 'export_workspace_data':
        return exportWorkspaceData({ userId: viewer.userId, workspaceId: viewer.workspaceId });
      case 'delete_workspace_data': {
        requireConfirmation(args, `DELETE WORKSPACE DATA ${viewer.workspaceId}`);
        const counts = await deleteWorkspaceData({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.apiKeyId ? { apiKeyId: viewer.apiKeyId } : {}) }, 'DELETE');
        return { deleted: true, counts };
      }
      case 'get_retention_status':
        return getRetentionStatus({ userId: viewer.userId, workspaceId: viewer.workspaceId });
      case 'prune_old_records': {
        requireConfirmation(args, RUN_RETENTION_CONFIRMATION);
        return runRetentionNow({ userId: viewer.userId, workspaceId: viewer.workspaceId }, args);
      }
        default: throw new OperationError('invalid_request', `Unknown tool: ${name}`);
      }
    },
  },
];
