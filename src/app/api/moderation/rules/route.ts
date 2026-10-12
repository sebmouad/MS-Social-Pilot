import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { canModerateComments } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/scheduler/runner';
import { assertRuleComplete, assertRulePages, ruleFields } from '@/lib/moderation-rules';
import { ok, readJson, route } from '@/lib/api';

const createSchema = z.object({
  ...ruleFields,
  enabled: ruleFields.enabled.default(true),
  targetIds: ruleFields.targetIds.default([]),
  keywords: ruleFields.keywords.default([]),
  replyText: ruleFields.replyText.default(null),
  dailyCap: ruleFields.dailyCap.default(20),
  oncePerUser: ruleFields.oncePerUser.default(true),
});

/** Rules a member may see: every one when they have every Page, else those naming only their Pages. */
export const GET = route(async () => {
  const auth = await requireCapability(canModerateComments);
  const rules = await prisma.moderationRule.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'asc' },
  });
  const scope = auth.pageScope;
  return ok({
    rules: scope.all
      ? rules
      : rules.filter((rule) => rule.targetIds.length > 0 && rule.targetIds.every((id) => scope.ids.includes(id))),
  });
});

export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canModerateComments);
  const input = createSchema.parse(await readJson(request));
  assertRuleComplete(input);
  await assertRulePages(auth.pageScope, auth.workspace.id, input.targetIds);

  const rule = await prisma.moderationRule.create({
    data: { ...input, targetIds: [...new Set(input.targetIds)], workspaceId: auth.workspace.id },
  });
  await logActivity(auth.workspace.id, 'moderation.ruleChanged', { ruleId: rule.id, name: rule.name, change: 'created' }, auth.user.id);
  return ok({ rule }, 201);
});
