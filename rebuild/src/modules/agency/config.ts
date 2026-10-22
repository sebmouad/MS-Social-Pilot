import { agencyExportCatalog, agencyExportCopySchema } from './export-copy';
import { z } from 'zod';
import { customerCopy, customerCopySchema } from './ui/copy';
import { entry } from '@/lib/config/entry';
import { clientInvitationDefaults, clientInvitationPolicySchema, clientInvitationCopy, clientInvitationCopySchema } from './invitation-policy';

const weight = (key: string, label: string, description: string, defaultValue: number) =>
  entry({ key, group: 'Agency', label, kind: 'number', description, defaultValue, schema: z.number().int().min(0).max(10_000), consumption: 'active' });

/** Root-owned agency limits and attention weights. Every value is read at request time through `runtimeConfig`. */
export const AGENCY_CONFIG = [
  entry({ key: 'agency.clientInvitationPolicy', group: 'Agency · Client invitations', label: 'Client invitation policy', kind: 'json', description: 'Private Root client invitation lifetime, bounds, transaction settings and registration path. Issuance defaults off until registration token consumption is integrated; legacy listing and revocation remain available.', defaultValue: clientInvitationDefaults, schema: clientInvitationPolicySchema, consumption: 'active' }),
  entry({ key: 'agency.clientInvitationCopy', group: 'Agency · Client invitations', label: 'Client invitation copy', kind: 'json', description: 'English and French client invitation screen and email copy. Email placeholders are required exactly once.', defaultValue: clientInvitationCopy, schema: clientInvitationCopySchema, consumption: 'active' }),
  entry({ key: 'agency.exportCopy', group: 'Agency', label: 'Export copy', kind: 'json', description: 'English and French export controls, feedback, headings and column labels.', defaultValue: agencyExportCatalog, schema: agencyExportCopySchema, consumption: 'active' }),
  entry({ key: 'agency.customerCopy', group: 'Agency', label: 'Customer copy', kind: 'json', description: 'English and French customer screen labels, feedback and empty states.', defaultValue: customerCopy, schema: customerCopySchema, consumption: 'active' }),
  entry({ key: 'agency.workspaceIdMaxLength', group: 'Agency', label: 'Workspace selection identifier length', kind: 'number', description: 'Maximum workspace identifier length accepted by browser and MCP workspace selection.', defaultValue: 200, schema: z.number().int().min(1).max(2000), consumption: 'active' }),
  entry({ key: 'agency.workspaceLimit', group: 'Agency', label: 'Agency workspace limit', kind: 'number', description: 'Maximum workspaces shown in one agency overview. Name search runs before this limit.', defaultValue: 200, schema: z.number().int().min(1).max(2000), consumption: 'active' }),
  entry({ key: 'agency.failureWindowDays', group: 'Agency', label: 'Failed-post window (days)', kind: 'number', description: 'How far back failed posts count toward the agency attention signal.', defaultValue: 30, schema: z.number().int().min(1).max(365), consumption: 'active' }),
  entry({ key: 'agency.clientListLimit', group: 'Agency', label: 'Client list limit', kind: 'number', description: 'Maximum client accounts listed per workspace.', defaultValue: 200, schema: z.number().int().min(1).max(2000), consumption: 'active' }),
  entry({ key: 'agency.searchMaxLength', group: 'Agency', label: 'Agency search length', kind: 'number', description: 'Longest search text accepted by agency workspace and client search.', defaultValue: 200, schema: z.number().int().min(1).max(500), consumption: 'active' }),
  entry({ key: 'agency.accessConcurrency', group: 'Agency', label: 'Workspace access checks in parallel', kind: 'number', description: 'How many workspaces have their entitlement and permissions checked at the same time.', defaultValue: 8, schema: z.number().int().min(1).max(32), consumption: 'active' }),
  weight('agency.attentionWeightUnavailable', 'Attention weight: unavailable workspace', 'Sort weight of a suspended workspace or one being erased.', 1000),
  weight('agency.attentionWeightDisconnected', 'Attention weight: channel that cannot publish', 'Sort weight of each enabled channel that cannot publish.', 100),
  weight('agency.attentionWeightFailed', 'Attention weight: failed post', 'Sort weight of each failed post inside the failure window.', 10),
  weight('agency.attentionWeightOverdue', 'Attention weight: overdue task', 'Sort weight of each overdue open task.', 1),
] as const;
