import { analyticsCopy } from '../../server/copy';
import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readGoals } from '@/modules/analytics/goals/server/goals';
import { goalMetricText, goalPaceText, goalsLocale, goalsText, type GoalsCopyKey } from '@/modules/analytics/goals/copy';
import workflow from '@/modules/analytics/ui/reports/workflows.module.css';
import styles from './goals.module.css';
import { InfoTip } from '@/components';
import { GoalEditor } from './GoalEditor';

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
    {data && data.channels.length > 0 && <div className={styles.grid}>{data.channels.map(channel => <section key={channel.channelId} className={styles.card} aria-labelledby={`goal-${channel.channelId}`}>
      <h2 id={`goal-${channel.channelId}`}>{channel.channelName}</h2>
      {channel.goals.length ? <ul className={styles.progress} aria-label={t('progress')}>
        {channel.goals.map(g => { const label = goalMetricText(locale, g.metric, copy); return <li key={g.metric}><strong>{label}</strong><span>{g.actual === null ? t('noData') : number.format(g.actual)} / {number.format(g.target)} · {g.percent}%</span>
          <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, g.percent)} aria-label={`${label} ${g.percent}%`}><i style={{ width: `${Math.min(100, Math.max(0, g.percent))}%` }} /></div>
          <small>{t('pace')}{locale === 'fr' ? '\u202f: ' : ': '}{goalPaceText(locale, g.pace, copy)}</small></li>; })}
      </ul> : <p className={styles.empty}>{data.canManage ? t('none') : t('noneReadOnly')}</p>}
      {data.canManage && <GoalEditor copy={copy} locale={locale} channelId={channel.channelId} channelName={channel.channelName}
        metrics={channel.trackable.map(metric => ({ metric, label: goalMetricText(locale, metric, copy), value: channel.goals.find(g => g.metric === metric)?.target ?? null }))} />}
    </section>)}</div>}
  </div></PageFrame>;
}
