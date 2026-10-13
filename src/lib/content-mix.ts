import { ApprovalStatus, PostStatus, PublishMode } from '@prisma/client';
import { z } from 'zod';

import { canPublishWithoutApproval } from './constants';
import { notifyMixDry } from './email/notify';
import { AppError } from './errors';
import { emitWebhook } from './webhooks';
import { allocateQueueSlot } from './posts';
import { prisma } from './prisma';
import { logActivity } from './scheduler/runner';

/**
 * Content mix.
 *
 * Admins say, per Page or per group, how many posts of each label the coming
 * week should hold ("4 × Product · 1 × Tip"). Labels are the categories:
 * the team already tags posts with them. The plan is a rolling seven days, so
 * there is no week boundary to argue about and the answer is the same any day.
 *
 * The worker compares each Page's plan with what is scheduled. With auto-fill
 * on, it schedules labelled drafts (feed and evergreen drafts included) into
 * free queue times; either way a label that is short and has no draft left
 * "runs dry", which admins are told once until drafts come back.
 */

export const MIX_WINDOW_MS = 7 * 86_400_000;
export const MAX_PER_WEEK = 50;

/** Statuses that count as planned for the coming week. */
const PLANNED: PostStatus[] = [PostStatus.scheduled, PostStatus.pending_approval, PostStatus.publishing, PostStatus.published];

export const mixScopeSchema = z
  .object({ targetId: z.string().min(1).optional(), groupId: z.string().min(1).optional() })
  .refine((scope) => Boolean(scope.targetId) !== Boolean(scope.groupId), 'Choose a Page or a group.');

export const mixUpdateSchema = z.object({
  scope: mixScopeSchema,
  rules: z
    .array(z.object({ labelId: z.string().min(1), perWeek: z.number().int().min(1).max(MAX_PER_WEEK) }))
    .max(30)
    .refine((rules) => new Set(rules.map((rule) => rule.labelId)).size === rules.length, 'Each label once.'),
});

function scopeNotFound(): AppError {
  return new AppError({ key: 'errors.mixScopeNotFound', fallback: 'That Page, group or label is not in this workspace.', status: 404 });
}

/** Replace the rules of one Page or group. */
export async function saveMix(workspaceId: string, input: z.infer<typeof mixUpdateSchema>): Promise<void> {
  const { targetId, groupId } = input.scope;
  const [target, group, labels] = await Promise.all([
    targetId ? prisma.target.findFirst({ where: { id: targetId, workspaceId }, select: { id: true } }) : null,
    groupId ? prisma.pageGroup.findFirst({ where: { id: groupId, workspaceId }, select: { id: true } }) : null,
    prisma.label.count({ where: { workspaceId, id: { in: input.rules.map((rule) => rule.labelId) } } }),
  ]);
  if ((targetId && !target) || (groupId && !group) || labels !== input.rules.length) throw scopeNotFound();

  const where = { workspaceId, targetId: targetId ?? null, groupId: groupId ?? null };
  const kept = await prisma.contentMixRule.findMany({ where, select: { labelId: true, dryNotifiedAt: true } });
  const dry = new Map(kept.map((rule) => [rule.labelId, rule.dryNotifiedAt]));
  await prisma.$transaction([
    prisma.contentMixRule.deleteMany({ where }),
    prisma.contentMixRule.createMany({
      data: input.rules.map((rule) => ({ ...where, labelId: rule.labelId, perWeek: rule.perWeek, dryNotifiedAt: dry.get(rule.labelId) ?? null })),
    }),
  ]);
}

interface RuleRow {
  id: string;
  targetId: string | null;
  groupId: string | null;
  labelId: string;
  perWeek: number;
  dryNotifiedAt: Date | null;
}

/**
 * The mix each Page follows: its own rules when it has any, otherwise its
 * groups' rules (the larger number when two groups ask for the same label).
 */
export function effectiveMix(
  rules: RuleRow[],
  pageIds: string[],
  groupsOf: Map<string, string[]>,
): Map<string, Map<string, { perWeek: number; rules: RuleRow[] }>> {
  const result = new Map<string, Map<string, { perWeek: number; rules: RuleRow[] }>>();
  for (const pageId of pageIds) {
    const own = rules.filter((rule) => rule.targetId === pageId);
    const groups = groupsOf.get(pageId) ?? [];
    const source = own.length ? own : rules.filter((rule) => rule.groupId && groups.includes(rule.groupId));
    if (!source.length) continue;
    const mix = new Map<string, { perWeek: number; rules: RuleRow[] }>();
    for (const rule of source) {
      const entry = mix.get(rule.labelId) ?? { perWeek: 0, rules: [] };
      entry.perWeek = Math.max(entry.perWeek, rule.perWeek);
      entry.rules.push(rule);
      mix.set(rule.labelId, entry);
    }
    result.set(pageId, mix);
  }
  return result;
}

export interface MixLine {
  labelId: string;
  perWeek: number;
  planned: number;
  /** Drafts with this label for this Page that the worker may schedule. */
  drafts: number;
}

export interface PageMix {
  targetId: string;
  lines: MixLine[];
}

/** A draft the worker may put in the queue without anyone's further say. */
function mayAutoSchedule(
  draft: { approvalStatus: ApprovalStatus; authorId: string },
  requiresApproval: boolean,
  roles: Map<string, Parameters<typeof canPublishWithoutApproval>[0]>,
): boolean {
  if (draft.approvalStatus === ApprovalStatus.approved) return true;
  if (draft.approvalStatus !== ApprovalStatus.not_required) return false;
  if (!requiresApproval) return true;
  // In a workspace with approvals, a contributor's draft still needs review.
  const role = roles.get(draft.authorId);
  return Boolean(role && canPublishWithoutApproval(role));
}

interface Loaded {
  rules: RuleRow[];
  mixes: Map<string, Map<string, { perWeek: number; rules: RuleRow[] }>>;
  planned: Array<{ targets: Array<{ targetId: string }>; labels: Array<{ labelId: string }> }>;
  drafts: Array<{ id: string; createdAt: Date; authorId: string; approvalStatus: ApprovalStatus; targets: Array<{ targetId: string; target: { enabled: boolean } }>; labels: Array<{ labelId: string }> }>;
  requiresApproval: boolean;
  roles: Map<string, Parameters<typeof canPublishWithoutApproval>[0]>;
}

async function load(workspaceId: string, now: Date, pageIds?: string[]): Promise<Loaded> {
  const [rules, pages, workspace, memberships] = await Promise.all([
    prisma.contentMixRule.findMany({
      where: { workspaceId },
      select: { id: true, targetId: true, groupId: true, labelId: true, perWeek: true, dryNotifiedAt: true },
    }),
    prisma.target.findMany({
      where: { workspaceId, enabled: true, ...(pageIds ? { id: { in: pageIds } } : {}) },
      select: { id: true, groups: { select: { groupId: true } } },
    }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { requiresApproval: true } }),
    prisma.membership.findMany({ where: { workspaceId }, select: { userId: true, role: true } }),
  ]);
  const groupsOf = new Map(pages.map((page) => [page.id, page.groups.map((entry) => entry.groupId)]));
  const mixes = effectiveMix(rules, pages.map((page) => page.id), groupsOf);
  const ids = [...mixes.keys()];
  const labelIds = [...new Set(rules.map((rule) => rule.labelId))];
  const [planned, drafts] = ids.length
    ? await Promise.all([
        prisma.post.findMany({
          where: {
            workspaceId,
            status: { in: PLANNED },
            scheduledAt: { gte: now, lt: new Date(now.getTime() + MIX_WINDOW_MS) },
            targets: { some: { targetId: { in: ids } } },
          },
          select: { targets: { select: { targetId: true } }, labels: { select: { labelId: true } } },
        }),
        prisma.post.findMany({
          where: {
            workspaceId,
            status: PostStatus.draft,
            targets: { some: { targetId: { in: ids } } },
            labels: { some: { labelId: { in: labelIds } } },
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            createdAt: true,
            authorId: true,
            approvalStatus: true,
            targets: { select: { targetId: true, target: { select: { enabled: true } } } },
            labels: { select: { labelId: true } },
          },
        }),
      ])
    : [[], []];
  return {
    rules,
    mixes,
    planned,
    drafts,
    requiresApproval: workspace.requiresApproval,
    roles: new Map(memberships.map((membership) => [membership.userId, membership.role])),
  };
}

function usable(data: Loaded, pageId: string, labelId: string, used: Set<string>) {
  return data.drafts.filter(
    (draft) =>
      !used.has(draft.id) &&
      draft.targets.some((target) => target.targetId === pageId) &&
      draft.targets.every((target) => target.target.enabled) &&
      draft.labels.some((label) => label.labelId === labelId) &&
      mayAutoSchedule(draft, data.requiresApproval, data.roles),
  );
}

function plannedCount(data: Loaded, pageId: string, labelId: string): number {
  return data.planned.filter(
    (post) => post.targets.some((target) => target.targetId === pageId) && post.labels.some((label) => label.labelId === labelId),
  ).length;
}

/** The plan against what is scheduled, for the screen. */
export async function mixStatus(workspaceId: string, now: Date, pageIds?: string[]): Promise<PageMix[]> {
  const data = await load(workspaceId, now, pageIds);
  return [...data.mixes].map(([targetId, mix]) => ({
    targetId,
    lines: [...mix].map(([labelId, entry]) => ({
      labelId,
      perWeek: entry.perWeek,
      planned: plannedCount(data, targetId, labelId),
      drafts: usable(data, targetId, labelId, new Set()).length,
    })),
  }));
}

/**
 * The worker's job: fill each Page's mix from drafts (when the workspace
 * allows it) and tell admins about labels that ran dry. Database only.
 */
export async function runContentMix(now = new Date()): Promise<{ scheduled: number; dry: number }> {
  const workspaces = await prisma.contentMixRule.findMany({ distinct: ['workspaceId'], select: { workspaceId: true } });
  let scheduled = 0;
  let dry = 0;
  for (const { workspaceId } of workspaces) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true, mixAutoFill: true } });
    if (!workspace) continue;
    const data = await load(workspaceId, now);
    const used = new Set<string>();
    const ranDry: Array<{ targetId: string; labelId: string; rules: RuleRow[] }> = [];
    const recovered: string[] = [];

    for (const [targetId, mix] of data.mixes) {
      for (const [labelId, entry] of mix) {
        let short = entry.perWeek - plannedCount(data, targetId, labelId);
        const candidates = usable(data, targetId, labelId, used);
        while (workspace.mixAutoFill && short > 0 && candidates.length) {
          const draft = candidates.shift()!;
          const at = await scheduleDraft(workspaceId, workspace.timezone, draft.id, draft.targets.map((target) => target.targetId), now);
          if (!at) break;
          used.add(draft.id);
          scheduled += 1;
          short -= 1;
          // Counts for every Page and label it carries, not only this one.
          data.planned.push({ targets: draft.targets, labels: draft.labels });
          await logActivity(workspaceId, 'queue.mixScheduled', { postId: draft.id, labelId, targetId, at: at.toISOString() });
          await announce(workspaceId, draft.id, at);
        }
        if (short > 0 && candidates.length === 0) ranDry.push({ targetId, labelId, rules: entry.rules });
        else recovered.push(...entry.rules.filter((rule) => rule.dryNotifiedAt).map((rule) => rule.id));
      }
    }

    if (recovered.length) await prisma.contentMixRule.updateMany({ where: { id: { in: recovered } }, data: { dryNotifiedAt: null } });
    for (const entry of ranDry) {
      const fresh = entry.rules.filter((rule) => !rule.dryNotifiedAt).map((rule) => rule.id);
      if (!fresh.length) continue;
      // Claimed first, so two workers never send it twice.
      const { count } = await prisma.contentMixRule.updateMany({ where: { id: { in: fresh }, dryNotifiedAt: null }, data: { dryNotifiedAt: now } });
      if (count === 0) continue;
      dry += 1;
      await notifyMixDry({ workspaceId, targetId: entry.targetId, labelId: entry.labelId });
    }
  }
  return { scheduled, dry };
}

/** Outgoing webhooks (H18) hear of it as of any scheduled post. */
async function announce(workspaceId: string, postId: string, at: Date): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { message: true, targets: { select: { target: { select: { id: true, name: true, type: true } } } } },
  });
  if (!post) return;
  await emitWebhook(workspaceId, 'post.scheduled', {
    postId,
    scheduledAt: at.toISOString(),
    pages: post.targets.map(({ target }) => ({ pageId: target.id, pageName: target.name, network: target.type })),
    message: post.message,
  });
}

/**
 * Put one draft in the next free queue time of its Pages, inside the coming
 * week. Null when there is no such time: the queue is full, and scheduling
 * further out would not help this week's mix.
 */
async function scheduleDraft(workspaceId: string, timeZone: string, postId: string, targetIds: string[], now: Date): Promise<Date | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const at = await allocateQueueSlot(tx, workspaceId, timeZone, now, targetIds);
      if (at.getTime() >= now.getTime() + MIX_WINDOW_MS) return null;
      const { count } = await tx.post.updateMany({
        where: { id: postId, workspaceId, status: PostStatus.draft },
        data: { status: PostStatus.scheduled, scheduledAt: at, timezone: timeZone, publishMode: PublishMode.worker },
      });
      return count === 1 ? at : null;
    });
  } catch (error) {
    // No queue times, or none free: nothing to fill this time.
    if (error instanceof AppError) return null;
    throw error;
  }
}
