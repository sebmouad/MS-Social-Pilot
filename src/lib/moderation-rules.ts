import { z } from 'zod';

import { errors } from './errors';
import { assertPagesAllowed, type PageScope } from './page-access';
import { prisma } from './prisma';
import { ACTIONS, MATCHES } from './moderation';

/** The form fields of a moderation rule, shared by create and edit. */
export const ruleFields = {
  name: z.string().trim().min(1, 'Give this rule a name.').max(120),
  enabled: z.boolean(),
  targetIds: z.array(z.string().min(1)).max(500),
  match: z.enum(MATCHES),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100),
  action: z.enum(ACTIONS),
  replyText: z.string().trim().max(2000).nullable(),
  dailyCap: z.number().int().min(1).max(500),
  oncePerUser: z.boolean(),
};

/**
 * Check the Pages a rule names: they must be this workspace's, and a member
 * limited to some Pages cannot write a rule for every Page.
 */
export async function assertRulePages(scope: PageScope, workspaceId: string, targetIds: string[]): Promise<void> {
  if (targetIds.length === 0) {
    if (!scope.all) throw errors.targetsUnavailable();
    return;
  }
  assertPagesAllowed(scope, targetIds);
  const found = await prisma.target.count({ where: { id: { in: targetIds }, workspaceId, type: 'page' } });
  if (found !== new Set(targetIds).size) throw errors.targetsUnavailable();
}

/**
 * A rule needs keywords to look for, or words to reply with. Checked on the
 * whole rule, after an edit is merged into what was stored.
 */
export function assertRuleComplete(rule: { match: string; keywords: string[]; action: string; replyText: string | null }): void {
  if (rule.match === 'keywords' && rule.keywords.length === 0) throw errors.ruleNeedsKeywords();
  if (rule.action === 'reply' && !rule.replyText?.trim()) throw errors.ruleNeedsReply();
}
