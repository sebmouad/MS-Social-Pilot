import { z } from 'zod';

/**
 * Client-safe vocabulary for the private Root legacy operations: confirmation
 * phrases and input schemas shared by the UI, HTTP routes, MCP definitions and
 * services. Nothing here imports server code.
 */
export const WORKSPACE_ROLES = ['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] as const;
export type LegacyWorkspaceRole = typeof WORKSPACE_ROLES[number];

export const idSchema = z.string().min(1).max(200);
export const confirmationSchema = z.string().min(1).max(400);

export const planConfirmation = {
  update: (key: string) => `UPDATE PLAN ${key}`,
  makeDefault: (key: string) => `SET DEFAULT PLAN ${key}`,
  assign: (key: string, email: string) => `ASSIGN PLAN ${key} TO ${email}`,
  unassign: (email: string) => `REMOVE PLAN FROM ${email}`,
};
export const roleConfirmation = (email: string, workspaceId: string, role: string) => `CHANGE ROLE ${email} IN ${workspaceId} TO ${role}`;
export const transferConfirmation = (workspaceId: string, email: string) => `TRANSFER WORKSPACE ${workspaceId} TO ${email}`;

/**
 * Plan feature keys stored on legacy plans. Keys are grouped by the module that
 * owns the capability, so Root presents entitlements per module. Platform keys
 * follow the `platform_<providerId>` protocol of the legacy plan table.
 */
export type PlanFeatureGroup = { id: string; title: string; features: readonly { key: string; label: string }[] };
export const SHARED_PLAN_FEATURES: PlanFeatureGroup = { id: 'shared', title: 'Shared controls', features: [
  { key: 'product_v2', label: 'Modular plan (pages must be listed)' },
  { key: 'clients', label: 'Client logins and review links' },
  { key: 'whiteLabel', label: 'White label' },
  { key: 'api', label: 'API access' },
] };
export const PRODUCT_PLAN_FEATURES: readonly PlanFeatureGroup[] = [
  { id: 'publishing', title: 'Publishing', features: [
    { key: 'publishing/posts', label: 'Posts and composer' }, { key: 'publishing/calendar', label: 'Calendar' },
    { key: 'publishing/queue', label: 'Queue and feeds' }, { key: 'publishing/approvals', label: 'Approvals' },
    { key: 'publishing/templates', label: 'Templates' },
  ] },
  { id: 'inbox', title: 'Inbox', features: [{ key: 'analytics/inbox', label: 'Conversations' }] },
  { id: 'analytics', title: 'Analytics', features: [{ key: 'analytics/overview', label: 'Overview' }, { key: 'analytics/reports', label: 'Reports' }] },
  { id: 'ads', title: 'Ads', features: [{ key: 'ads/performance', label: 'Performance' }] },
  { id: 'agency', title: 'Agency', features: [{ key: 'agency/overview', label: 'Managed workspaces' }, { key: 'agency/clients', label: 'Client overview' }] },
  { id: 'settings', title: 'Settings', features: [
    { key: 'settings/team', label: 'Team' }, { key: 'settings/sharing', label: 'Sharing' }, { key: 'settings/media', label: 'Media' },
  ] },
];

/** Catalog of known keys; installed platforms contribute `platform_<id>` groups. */
export function planFeatureCatalog(platforms: readonly { id: string; name: string }[]): PlanFeatureGroup[] {
  return [SHARED_PLAN_FEATURES, ...PRODUCT_PLAN_FEATURES, ...platforms.map(platform => ({ id: `platform:${platform.id}`, title: `${platform.name} (platform)`, features: [{ key: `platform_${platform.id}`, label: `${platform.name} access` }] }))];
}

const limit = z.number().int().min(0).max(1_000_000).nullable();
export const planPatchSchema = z.object({
  name: z.string().trim().min(1).max(60),
  currency: z.string().trim().length(3).toUpperCase(),
  priceMonthly: z.number().int().min(0).max(10_000_000),
  priceYearly: z.number().int().min(0).max(100_000_000),
  extraChannelPrice: z.number().int().min(0).max(1_000_000),
  channels: limit, members: limit, workspaces: limit, postsPerMonth: limit, aiCredits: limit,
  features: z.array(z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_/.-]{0,59}$/)).max(60),
  isDefault: z.boolean(),
}).partial().strict();
export type PlanPatch = z.infer<typeof planPatchSchema>;

export const planUpdateSchema = z.object({ patch: planPatchSchema, confirmation: confirmationSchema }).strict();
export const planAssignSchema = z.object({ userId: idSchema, planKey: z.string().min(1).max(100).nullable(), confirmation: confirmationSchema }).strict();
export const roleChangeSchema = z.object({ membershipId: idSchema, role: z.enum(WORKSPACE_ROLES), confirmation: confirmationSchema }).strict();
export const transferSchema = z.object({ workspaceId: idSchema, newOwnerEmail: z.string().trim().toLowerCase().email().max(320), previousOwners: z.enum(['keep', 'demote_admin']), confirmation: confirmationSchema }).strict();
export const errorResolveSchema = z.object({ resolved: z.boolean() }).strict();

/** Stable first-party download protocol, shared by the server and confirmed download control. */
export const ROOT_PRIVILEGE_CSV_FORMAT = 'root-privileges-v1';
export const ROOT_PRIVILEGE_CSV_NAME = 'privileges.csv';
