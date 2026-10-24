import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Root-owned bounds consumed by Inbox moderation rules (src/modules/inbox/server/moderation.ts). */
export const INBOX_MODERATION_CONFIG = [
  entry({ key: 'inbox.moderationRuleLimit', group: 'Inbox · Moderation', label: 'Moderation rules per workspace', kind: 'number', description: 'Maximum moderation rules one workspace can keep.', defaultValue: 50, schema: z.number().int().min(1).max(500), consumption: 'active' }),
  entry({ key: 'inbox.moderationLogLimit', group: 'Inbox · Moderation', label: 'Moderation log page size', kind: 'number', description: 'Maximum moderation log entries returned in one read.', defaultValue: 100, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'inbox.moderationFreshHours', group: 'Inbox · Moderation', label: 'Moderation comment age limit (hours)', kind: 'number', description: 'Comments older than this when rules run are history and are not acted on.', defaultValue: 48, schema: z.number().int().min(1).max(720), consumption: 'active' }),
  entry({ key: 'inbox.moderationRunMaxComments', group: 'Inbox · Moderation', label: 'Comments checked per moderation run', kind: 'number', description: 'Maximum stored comments one moderation run examines.', defaultValue: 200, schema: z.number().int().min(1).max(5000), consumption: 'active' }),
  entry({ key: 'inbox.moderationAutoRun', group: 'Inbox · Moderation', label: 'Run moderation rules after each sync', kind: 'boolean', description: 'After the Inbox sync job, apply enabled rules automatically, acting with the authority of an active workspace owner whose current access qualifies.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'inbox.moderationAutoWorkspaceLimit', group: 'Inbox · Moderation', label: 'Workspaces moderated per sync', kind: 'number', description: 'Most workspaces the automatic moderation pass handles after one Inbox sync; the rest wait for the next sync.', defaultValue: 100, schema: z.number().int().min(1).max(5000), consumption: 'active' }),
] as const;
