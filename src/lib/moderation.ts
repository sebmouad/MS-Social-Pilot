import { WorkspaceRole, type ModerationRule } from '@prisma/client';

import { prisma } from './prisma';
import { canModerateComments } from './constants';
import { deleteComment, replyToComment, setCommentHidden } from './facebook/edges';
import { asGraphError } from './facebook/graph';
import { notifyModerationAlert } from './email/notify';
import { tokenFor } from './engagement';
import { logActivity } from './scheduler/runner';
import { fillReply } from './reply-template';

/**
 * Comment moderation rules (NEXT_PHASES G7).
 *
 * The worker reads new comments on published posts; every one of them goes
 * through the workspace's rules here, once. A rule looks for links, phone
 * numbers or keywords and then hides the comment, alerts the team, or replies
 * as the Page. Every automatic action is logged and can be undone from the log.
 *
 * Facebook Pages only: a Page cannot hide its own comments (META_API_NOTES), so
 * comments written by the Page are never touched, and Instagram moderation
 * works differently.
 */

export const MATCHES = ['links', 'phones', 'keywords'] as const;
export type RuleMatch = (typeof MATCHES)[number];
export const ACTIONS = ['hide', 'alert', 'reply'] as const;
export type RuleAction = (typeof ACTIONS)[number];

/** Comments older than this when first seen are history, not something to act on. */
const FRESH_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(com|net|org|info|biz|io|co|me|ly|link|xyz|shop|site|online)\b(\/\S*)?/i;
/** Eight digits or more, allowing the spaces, dots, dashes and brackets people write. */
const PHONE = /(?:\+|\b)(?:\d[\s.\-()]{0,2}){8,}\d?/;

/** Lower case without accents, so "Promo" finds "PROMO" and "prómo". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function matchesRule(rule: Pick<ModerationRule, 'match' | 'keywords'>, text: string): boolean {
  if (!text.trim()) return false;
  switch (rule.match as RuleMatch) {
    case 'links':
      return LINK.test(text);
    case 'phones':
      return PHONE.test(text);
    case 'keywords': {
      const body = fold(text);
      return rule.keywords.some((keyword) => keyword.trim() && body.includes(fold(keyword.trim())));
    }
    default:
      return false;
  }
}

export { fillReply };

export interface IncomingComment {
  remoteId: string;
  message: string;
  fromId: string | null;
  fromName: string | null;
  createdTime: Date;
}

/**
 * Run the rules over comments the sync has just stored for one post. Never
 * throws: moderation trouble must not lose the comments that were read.
 */
export async function applyModerationRules(
  postTargetId: string,
  comments: IncomingComment[],
  now: Date = new Date(),
): Promise<number> {
  try {
    return await apply(postTargetId, comments, now);
  } catch (error) {
    console.error('[moderation] rules could not run', error);
    return 0;
  }
}

async function apply(postTargetId: string, comments: IncomingComment[], now: Date): Promise<number> {
  const fresh = comments.filter((comment) => now.getTime() - comment.createdTime.getTime() < FRESH_MS);
  if (fresh.length === 0) return 0;

  const row = await prisma.postTarget.findUnique({
    where: { id: postTargetId },
    select: {
      target: {
        select: {
          id: true,
          type: true,
          name: true,
          providerId: true,
          workspaceId: true,
          accessToken: true,
          socialAccount: { select: { accessToken: true } },
        },
      },
    },
  });
  const target = row?.target;
  if (!target || target.type !== 'page') return 0;

  const rules = await prisma.moderationRule.findMany({
    where: {
      workspaceId: target.workspaceId,
      enabled: true,
      OR: [{ targetIds: { isEmpty: true } }, { targetIds: { has: target.id } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (rules.length === 0) return 0;

  const token = tokenFor(target);
  let acted = 0;

  for (const comment of fresh) {
    // The Page's own words, including this app's replies.
    if (comment.fromId && comment.fromId === target.providerId) continue;

    for (const rule of rules) {
      if (!matchesRule(rule, comment.message)) continue;
      const action = rule.action as RuleAction;
      if ((action === 'hide' || action === 'reply') && !token) continue;

      const since = new Date(now.getTime() - DAY_MS);
      const today = await prisma.moderationAction.count({ where: { ruleId: rule.id, createdAt: { gte: since }, error: null } });
      if (today >= rule.dailyCap) continue;
      if (action === 'reply' && rule.oncePerUser && comment.fromId) {
        const answered = await prisma.moderationAction.count({
          where: { ruleId: rule.id, authorId: comment.fromId, action: 'reply', error: null },
        });
        if (answered > 0) continue;
      }

      // Claimed before acting: a second worker, or the next sync, finds the row
      // and leaves the comment alone.
      const claim = await prisma.moderationAction
        .create({
          data: {
            workspaceId: target.workspaceId,
            ruleId: rule.id,
            ruleName: rule.name,
            targetId: target.id,
            remoteCommentId: comment.remoteId,
            authorId: comment.fromId,
            authorName: comment.fromName,
            message: comment.message.slice(0, 500),
            action,
            createdAt: now,
          },
        })
        .catch(() => null);
      if (!claim) continue;

      try {
        if (action === 'hide') {
          await setCommentHidden(comment.remoteId, token!, true);
          await prisma.postComment.updateMany({ where: { postTargetId, remoteId: comment.remoteId }, data: { isHidden: true } });
        } else if (action === 'reply') {
          const text = fillReply(rule.replyText ?? '', { name: comment.fromName, page: target.name });
          if (!text) throw new Error('The reply is empty.');
          const replyId = await replyToComment(comment.remoteId, token!, text);
          await prisma.moderationAction.update({ where: { id: claim.id }, data: { replyRemoteId: replyId } });
        } else {
          await notifyModerationAlert({
            workspaceId: target.workspaceId,
            targetId: target.id,
            page: target.name,
            rule: rule.name,
            author: comment.fromName,
            message: comment.message,
          });
        }
        acted += 1;
      } catch (error) {
        const graph = asGraphError(error);
        await prisma.moderationAction.update({ where: { id: claim.id }, data: { error: graph.displayMessage.slice(0, 500) } });
        // Over the app's allowance: every further call would be refused too.
        if (graph.code === 4 || graph.code === 32 || graph.code === 613) return acted;
      }
      // One rule per comment: a hidden comment needs no reply as well.
      break;
    }
  }
  return acted;
}

export type UndoOutcome = 'ok' | 'not_found' | 'forbidden' | 'not_undoable' | 'failed';

/** Put back what a rule did: unhide the comment, or delete the Page's reply. */
export async function undoModerationAction(options: {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<{ outcome: UndoOutcome; error?: string }> {
  if (!canModerateComments(options.role)) return { outcome: 'forbidden' };
  const action = await prisma.moderationAction.findFirst({ where: { id: options.id, workspaceId: options.workspaceId } });
  if (!action) return { outcome: 'not_found' };
  if (action.undoneAt || action.error || action.action === 'alert') return { outcome: 'not_undoable' };

  const target = await prisma.target.findFirst({
    where: { id: action.targetId, workspaceId: options.workspaceId },
    select: { accessToken: true, socialAccount: { select: { accessToken: true } } },
  });
  const token = target ? tokenFor(target) : null;
  if (!token) return { outcome: 'failed', error: 'The Page is no longer connected.' };

  try {
    if (action.action === 'hide') {
      await setCommentHidden(action.remoteCommentId, token, false);
      await prisma.postComment.updateMany({ where: { remoteId: action.remoteCommentId }, data: { isHidden: false } });
    } else if (action.replyRemoteId) {
      await deleteComment(action.replyRemoteId, token);
      await prisma.postComment.deleteMany({ where: { remoteId: action.replyRemoteId } });
    }
  } catch (error) {
    return { outcome: 'failed', error: asGraphError(error).displayMessage };
  }

  await prisma.moderationAction.update({
    where: { id: action.id },
    data: { undoneAt: new Date(), undoneById: options.userId },
  });
  await logActivity(options.workspaceId, 'moderation.undone', { actionId: action.id, rule: action.ruleName }, options.userId);
  return { outcome: 'ok' };
}
