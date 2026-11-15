import { analyticsCopy } from '../../server/copy';
import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readGoals } from '@/modules/analytics/goals/server/goals';
import { goalMetricText, goalPaceText, goalsLocale, goalsText, type GoalsCopyKey } from '@/modules/analytics/goals/copy';
import workflow from '@/modules/analytics/ui/reports/workflows.module.css';
import { InfoTip } from '@/components';
import { GoalsTable, type GoalRow } from './GoalsTable';

export default async function GoalsPage() {
  const viewer = await requireViewer({ feature: 'analytics/goals', channelScoped: true });
  const locale = goalsLocale((await headers()).get('accept-language'));
  const { goals: copy } = await analyticsCopy();
  const t = (key: GoalsCopyKey, values?: Record<string, string | number>) => goalsText(locale, key, values, copy);
  const number = new Intl.NumberFormat(locale);
  let failure = ''; let data: Awaited<ReturnType<typeof readGoals>> | null = null;
  try { data = await readGoals({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); }
  catch (error) { failure = operationFailure(error, t('loadFailed')).error; }
  const info = data ? <InfoTip name={t('title')} blocks={[{ text: t('subtitle', { from: data.month.start, to: data.month.end, zone: data.month.timeZone }) }, ...(data.canManage ? [{ text: t('editHint') }] : [])]} /> : undefined;
  return <PageFrame module="analytics" scopedAccess><div className={workflow.root}>
    <PageHeader module="analytics" title={t('title')} info={info} />
    {failure && <section className={workflow.panel} role="alert"><h2>{t('loadFailedTitle')}</h2><p>{failure}</p><a href="/insights/goals">{t('retry')}</a></section>}
    {data && !data.channels.length && <section className={workflow.panel}><h2>{t('noChannelsTitle')}</h2><p>{t('noChannels')}</p><a href="/settings/channels">{t('manageConnections')}</a></section>}
    {data && data.channels.length > 0 && (() => {
      // One table for every channel (2026-11-15); a channel that cannot track a goal shows « — » in that column.
      const metricIds = [...new Set(data.channels.flatMap(channel => channel.trackable))];
      const metrics = metricIds.map(metric => ({ metric, label: goalMetricText(locale, metric, copy) }));
      const rows: GoalRow[] = data.channels.map(channel => ({
        channelId: channel.channelId, channelName: channel.channelName,
        targets: Object.fromEntries(channel.trackable.map(metric => [metric, channel.goals.find(g => g.metric === metric)?.target ?? null])),
        progress: channel.goals.map(g => ({ metric: g.metric, label: goalMetricText(locale, g.metric, copy), percent: g.percent, pace: goalPaceText(locale, g.pace, copy),
          text: `${g.actual === null ? t('noData') : number.format(g.actual)} / ${number.format(g.target)} · ${g.percent}%` })),
      }));
      return <GoalsTable locale={locale} rows={rows} metrics={metrics} copy={copy} canManage={data.canManage} />;
    })()}
  </div></PageFrame>;
}
