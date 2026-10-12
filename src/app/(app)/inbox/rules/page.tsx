import { ScreenHeader } from '@/components/ScreenHeader';
import { getFormatter, getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/EmptyState';
import { ModerationRulesClient, type ModerationLogView, type ModerationRuleView } from '@/components/ModerationRulesClient';
import { requirePage } from '@/lib/auth';
import { canModerateComments } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { targetScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('moderation.title');
}

/** How many of the latest automatic actions the log lists. */
const LOG_SIZE = 50;

/**
 * Rules the worker applies to every new comment on the workspace's Facebook
 * Pages (hide, alert, reply), and the log of what they did, each undoable.
 */
export default async function ModerationRulesPage() {
  const auth = await requirePage();
  const t = await getTranslations('moderation');
  const format = await getFormatter();

  if (!canModerateComments(auth.role)) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold sm:text-2xl text-slate-900">{t('title')}</h1>
        <EmptyState icon="shield" title={t('noAccessTitle')} hint={t('noAccessHint')} />
      </div>
    );
  }

  const scope = auth.pageScope;
  const [pages, rules, actions] = await Promise.all([
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, type: 'page', ...targetScope(scope) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.moderationRule.findMany({ where: { workspaceId: auth.workspace.id }, orderBy: { createdAt: 'asc' } }),
    prisma.moderationAction.findMany({
      where: { workspaceId: auth.workspace.id, ...(scope.all ? {} : { targetId: { in: scope.ids } }) },
      orderBy: { createdAt: 'desc' },
      take: LOG_SIZE,
    }),
  ]);
  const pageName = new Map(pages.map((page) => [page.id, page.name]));

  // A member limited to some Pages sees the rules that touch only their Pages.
  const visible = scope.all
    ? rules
    : rules.filter((rule) => rule.targetIds.length > 0 && rule.targetIds.every((id) => scope.ids.includes(id)));

  const ruleViews: ModerationRuleView[] = visible.map((rule) => ({
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    targetIds: rule.targetIds,
    match: rule.match as ModerationRuleView['match'],
    keywords: rule.keywords,
    action: rule.action as ModerationRuleView['action'],
    replyText: rule.replyText,
    dailyCap: rule.dailyCap,
    oncePerUser: rule.oncePerUser,
  }));

  const log: ModerationLogView[] = actions.map((action) => ({
    id: action.id,
    when: format.dateTime(action.createdAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: auth.workspace.timezone }),
    page: pageName.get(action.targetId) ?? null,
    rule: action.ruleName,
    author: action.authorName,
    message: action.message,
    action: action.action as ModerationLogView['action'],
    error: action.error,
    undone: action.undoneAt !== null,
  }));

  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('intro')} />
      <ModerationRulesClient rules={ruleViews} pages={pages} log={log} allPages={scope.all} />
    </div>
  );
}
