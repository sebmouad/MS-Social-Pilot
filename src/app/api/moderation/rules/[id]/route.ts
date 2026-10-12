import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { canModerateComments } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { errors } from '@/lib/errors';
import { logActivity } from '@/lib/scheduler/runner';
import { assertRuleComplete, assertRulePages, ruleFields } from '@/lib/moderation-rules';
import { ok, readJson, route } from '@/lib/api';

const patchSchema = z.object(ruleFields).partial();

type Context = { params: Promise<{ id: string }> };

/** The rule, if this member may change it: it must name only Pages they have. */
async function findRule(id: string, auth: Awaited<ReturnType<typeof requireCapability>>) {
  const rule = await prisma.moderationRule.findFirst({ where: { id, workspaceId: auth.workspace.id } });
  if (!rule) throw errors.notFound();
  const scope = auth.pageScope;
  if (!scope.all && (rule.targetIds.length === 0 || rule.targetIds.some((target) => !scope.ids.includes(target)))) {
    throw errors.notFound();
  }
  return rule;
}

export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canModerateComments);
  const { id } = await context.params;
  const input = patchSchema.parse(await readJson(request));
  const rule = await findRule(id, auth);

  const merged = { ...rule, ...input };
  assertRuleComplete(merged);
  if (input.targetIds) await assertRulePages(auth.pageScope, auth.workspace.id, input.targetIds);

  const updated = await prisma.moderationRule.update({
    where: { id },
    data: { ...input, ...(input.targetIds ? { targetIds: [...new Set(input.targetIds)] } : {}) },
  });
  await logActivity(auth.workspace.id, 'moderation.ruleChanged', { ruleId: id, name: updated.name, change: 'updated' }, auth.user.id);
  return ok({ rule: updated });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canModerateComments);
  const { id } = await context.params;
  const rule = await findRule(id, auth);
  await prisma.moderationRule.delete({ where: { id } });
  await logActivity(auth.workspace.id, 'moderation.ruleChanged', { ruleId: id, name: rule.name, change: 'deleted' }, auth.user.id);
  return ok({ deleted: true });
});
