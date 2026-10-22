import { HISTORY_FEATURE_ID } from './manifest';

export { HISTORY_FEATURE_ID };
/** History names who did what and, for removed items, may hold the only surviving record, so it is for managers only. */
export const HISTORY_READ_ROLES: readonly string[] = ['owner', 'admin'];

/** MCP tool -> required access. Both tools are reads. */
export const HISTORY_TOOL_ACCESS = { list_workspace_activity: 'read', list_workspace_email_log: 'read' } as const;

export type HistoryActor = {
  userId: string;
  workspaceId: string;
  /** Deny-only ceiling carried by a restricted MCP key; sessions have none. */
  permissionCeiling?: import('@/server/permissions').ScopedPermissions;
};
