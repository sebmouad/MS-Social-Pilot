/** Provider-neutral agency vocabulary. Agency views are per-person and span workspaces; they are not Root. */
export const AGENCY_MODULE_ID = 'agency';
export const AGENCY_OVERVIEW_FEATURE_ID = 'agency/overview';
export const AGENCY_CLIENTS_FEATURE_ID = 'agency/clients';

export type AgencyActor = { userId: string };
export const AGENCY_SORTS = ['name', 'channels', 'attention', 'scheduled', 'failed', 'waitingConversations', 'openTasks', 'overdueTasks', 'members'] as const;
export type AgencySort = (typeof AGENCY_SORTS)[number];

/** Capability groups. Each is counted only where the person holds that feature's permission and entitlement in that workspace. */
export const AGENCY_GROUPS = ['channels', 'publishing', 'inbox', 'tasks', 'team'] as const;
export type AgencyGroup = (typeof AGENCY_GROUPS)[number];
export type AgencyAccess = Record<AgencyGroup, boolean>;

/** A null count is withheld (not entitled, no permission or limited channel scope), never zero. */
export type AgencyMetrics = {
  /** Enabled channels that cannot currently publish. Never includes credentials or provider detail. */
  channels: number | null; disconnected: number | null;
  scheduled: number | null; failed: number | null;
  /** Unresolved conversations, top-level visible comments and reviews. Never confused with open Tasks. */
  waitingConversations: number | null;
  openTasks: number | null; overdueTasks: number | null;
  members: number | null; clients: number | null;
};
/**
 * available: metrics are present. suspended / deleting: the person still sees the workspace they administer,
 * but its data is withheld because the workspace cannot be used right now. A workspace the person's plan or Root
 * policy does not entitle to Agency is omitted, never listed as a gap.
 */
export type AgencyWorkspaceState = 'available' | 'suspended' | 'deleting';
export type AgencyWorkspace = {
  id: string; name: string; role: 'owner' | 'admin'; state: AgencyWorkspaceState;
  metrics: AgencyMetrics | null; needsAttention: boolean;
};
/** `covered` of `of` available workspaces contributed to a group; a total with covered 0 is null. */
export type AgencyCoverage = Record<AgencyGroup, { covered: number; of: number }>;
export type AgencyTotals = {
  workspaces: number; needingAttention: number; channels: number | null; disconnected: number | null;
  scheduled: number | null; failed: number | null; waitingConversations: number | null;
  openTasks: number | null; overdueTasks: number | null;
  coverage: AgencyCoverage;
};
/** `filtered`: the name search narrowed the workspaces, so totals describe the matching workspaces only. */
export type AgencyOverview = { ok: true; windowDays: number; limit: number; truncated: boolean; filtered: boolean; totals: AgencyTotals; workspaces: AgencyWorkspace[] };

export type AgencyClient = {
  workspaceId: string; workspaceName: string; role: 'owner' | 'admin'; state: AgencyWorkspaceState;
  /** Null when this person cannot read the workspace team. With a search it counts matching accounts only. */
  clientCount: number | null;
  clients: Array<{ userId: string; name: string; email: string; status: 'active' }>;
  invitations: Array<{ id: string; email: string; status: 'pending' | 'expired'; expiresAt: string }>;
  /** False when invitations cannot be read or sent (mail, permission or policy); manage them from Team settings. */
  invitationsAvailable: boolean;
};
export type AgencyClients = { ok: true; limit: number; truncated: boolean; filtered: boolean; workspaces: AgencyClient[] };
