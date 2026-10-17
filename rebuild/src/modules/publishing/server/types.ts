import type { Entitlements } from '@/server/entitlements';
import type { ScopedPermissions } from '@/server/permissions';

export type PublishingFeature = 'publishing/posts' | 'publishing/templates' | 'publishing/approvals' | 'publishing/queue' | 'publishing/calendar';
export type PublishingActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] };
export type PublishingAuthorization = {
  actor: PublishingActor;
  role: string;
  permissions: ScopedPermissions;
  entitlements: Entitlements;
};
