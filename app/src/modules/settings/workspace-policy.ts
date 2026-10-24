import { z } from 'zod';

export type WorkspacePolicyActor = { userId: string; workspaceId: string };
export const workspacePolicySchema = z.object({ timezone: z.string().trim().min(1).max(128), requiresApproval: z.boolean(), confirmation: z.string().max(400) }).strict();
export const workspacePolicyConfirmation = (workspaceId: string) => `UPDATE WORKSPACE POLICY ${workspaceId}`;
/** Legacy role semantics: owners, admins and editors publish without review. */
export const needsContributorApproval = (requiresApproval: boolean, role: string) => requiresApproval && !['owner', 'admin', 'editor'].includes(role);
export const workspacePolicyModuleMetadata = { id: 'settings/workspace-policy', permissions: ['settings/workspace'], authority: 'active workspace owner or admin', persistedFields: ['workspaces.timezone', 'workspaces.requiresApproval'], auditAction: 'workspace.policy_updated' } as const;
