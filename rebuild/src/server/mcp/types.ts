import type { Entitlements } from '../entitlements';
import type { ScopedPermissions } from '../permissions';

export type McpViewer = {
  scope: 'workspace'; userId: string; workspaceId: string; role: string;
  workspace: { id: string; name: string; timezone: string };
  entitlements: Entitlements; permissions?: ScopedPermissions;
  maxResultItems?: number; resourceRestricted?: boolean; allowedAdAccountIds?: readonly string[]; adAccountTargetScope?: ScopedPermissions['pageScope']; apiKeyId?: string; isInstanceOwner?: boolean;
};
export type McpInstallationViewer = {
  scope: 'installation'; userId: string; isInstanceOwner: true;
  maxResultItems?: number; apiKeyId?: never;
};
export type McpIdentity = McpViewer | McpInstallationViewer;
export type RootMcpActor = Pick<McpViewer, 'userId' | 'isInstanceOwner' | 'apiKeyId' | 'maxResultItems'>;
