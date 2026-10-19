import { z } from 'zod';
import { SETTINGS_INVITATION_CONFIG } from './invitations-config';
import { SETTINGS_WORKSPACE_CONFIG } from './workspace-policy-config';
import { ACCOUNT_RECOVERY_CONFIG } from './account-recovery-config';
import { NOTIFICATIONS_CONFIG } from './notifications/config';
import { entry, cron } from '@/lib/config/entry';

export const SETTINGS_CONFIG = [
  entry({ key: 'settings.teamDefaultRole', group: 'Settings · Team', label: 'New member default role', kind: 'select', description: 'Initial non-manager role in the Add member form. Every submitted role still requires explicit confirmation and current authority.', defaultValue: 'contributor', schema: z.enum(['editor', 'contributor', 'viewer', 'client']), consumption: 'active', options: [{ value: 'editor', label: 'Editor' }, { value: 'contributor', label: 'Contributor' }, { value: 'viewer', label: 'Viewer' }, { value: 'client', label: 'Client' }] }),
  entry({ key: 'settings.teamDefaultAllChannels', group: 'Settings · Team', label: 'New members initially select all channels', kind: 'boolean', description: 'Initial channel choice in the Add member form. False starts with no grants selected. Manager roles always include every channel.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'settings.teamMaxMembers', group: 'Settings · Team', label: 'Maximum team members', kind: 'number', description: 'Maximum memberships in one workspace, including disabled accounts. Larger directories are refused without returning a partial list. This installation ceiling does not replace subscription seat policy.', defaultValue: 500, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'settings.teamMaxChannels', group: 'Settings · Team', label: 'Maximum team destinations', kind: 'number', description: 'Maximum selected destinations in one team membership scope.', defaultValue: 1000, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'settings.teamOperationTimeoutMs', group: 'Settings · Team', label: 'Team transaction timeout (ms)', kind: 'number', description: 'Maximum time allowed for the database transaction in a team directory or membership operation.', defaultValue: 15000, schema: z.number().int().min(1000).max(300000), consumption: 'active' }),
  entry({ key: 'settings.teamOperationMaxWaitMs', group: 'Settings · Team', label: 'Team operation lock wait (ms)', kind: 'number', description: 'Maximum time to wait for a team operation transaction.', defaultValue: 2000, schema: z.number().int().min(100).max(30000), consumption: 'active' }),
] as const;

/** Every Root setting this product module declares. The registry merges installed modules; edit only here. */
export const SETTINGS_MODULE_CONFIG = [
  ...SETTINGS_CONFIG,
  ...SETTINGS_INVITATION_CONFIG,
  ...SETTINGS_WORKSPACE_CONFIG,
  ...ACCOUNT_RECOVERY_CONFIG,
  ...NOTIFICATIONS_CONFIG,
  entry({ key: 'connections.statusLabels', group: 'Connections', label: 'Connection status labels', kind: 'json', description: 'Customer-facing labels for connected, expired and revoked sources. Health and permission checks are independent of these labels.', defaultValue: { connected: 'Connected', expired: 'Reconnect needed', revoked: 'Reconnect needed' }, schema: z.object({ connected: z.string().trim().min(1).max(80), expired: z.string().trim().min(1).max(80), revoked: z.string().trim().min(1).max(80) }).strict(), consumption: 'active' }),
  entry({ key: 'data.purgeRecoverySchedule', group: 'Data controls', label: 'Workspace erasure recovery schedule', kind: 'text', description: 'Five-field cron schedule for resuming already-confirmed workspace deletions after interruption.', defaultValue: '*/7 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'data.deleteTransactionTimeoutMs', group: 'Data controls', label: 'Workspace deletion timeout (ms)', kind: 'number', description: 'Maximum time allowed for one transactional workspace database deletion.', defaultValue: 120000, schema: z.number().int().min(5000).max(3600000), consumption: 'active' }),
  entry({ key: 'data.maxArchiveBytes', group: 'Data controls', label: 'Maximum workspace archive bytes', kind: 'number', description: 'Safety ceiling for a synchronous workspace export. Exceeding it stops the download without creating a partial archive.', defaultValue: 268435456, schema: z.number().int().min(1048576).max(2147483648), consumption: 'active' }),
  entry({ key: 'mcp.keys.maxActivePerWorkspace', group: 'MCP · API keys', label: 'Active API keys per workspace', kind: 'number', description: 'Maximum non-expired, non-revoked MCP bearer keys in each workspace.', defaultValue: 10, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'mcp.keys.maxLifetimeDays', group: 'MCP · API keys', label: 'Maximum API key lifetime (days)', kind: 'number', description: 'Longest lifetime workspace admins may select when issuing an MCP key.', defaultValue: 365, schema: z.number().int().min(1).max(3650), consumption: 'active' }),
  entry({ key: 'mcp.keys.maxResourceIds', group: 'MCP · API keys', label: 'API key resource selection limit', kind: 'number', description: 'Maximum explicitly selected channel and ad account identities on one key; also bounds issuance discovery.', defaultValue: 1000, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'mcp.keys.transactionTimeoutMs', group: 'MCP · API keys', label: 'API key transaction timeout', kind: 'number', description: 'Maximum duration of a guarded API key issuance or revocation transaction.', defaultValue: 15000, schema: z.number().int().min(1000).max(300000), consumption: 'active' }),
  entry({ key: 'mcp.keys.transactionMaxWaitMs', group: 'MCP · API keys', label: 'API key transaction wait', kind: 'number', description: 'Maximum time to wait for an API key transaction.', defaultValue: 2000, schema: z.number().int().min(100).max(30000), consumption: 'active' }),
  entry({ key: 'mcp.keys.defaultLifetimeDays', group: 'MCP · API keys', label: 'API key default lifetime', kind: 'number', description: 'Initial customer key lifetime, clamped to the maximum allowed lifetime.', defaultValue: 90, schema: z.number().int().min(1).max(3650), consumption: 'active' }),
  entry({ key: 'mcp.keys.requestsPerMinute', group: 'MCP · API keys', label: 'API key requests per minute', kind: 'number', description: 'Request budget applied independently to each MCP bearer key.', defaultValue: 60, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
] as const;
