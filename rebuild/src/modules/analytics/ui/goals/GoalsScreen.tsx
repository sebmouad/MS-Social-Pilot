import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readGoals } from '@/modules/analytics/goals/server/goals';
import { goalMetricText, goalPaceText, goalsLocale, goalsText, type GoalsCopyKey } from '@/modules/analytics/goals/copy';
import { WorkflowNav } from '@/modules/analytics/ui/reports/WorkflowNav';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import { GoalEditor } from './GoalEditor';

export default async function GoalsPage() {
  const viewer = await requireViewer({ feature: 'analytics/goals', channelScoped: true });
  const locale = goalsLocale((await headers()).get('accept-language'));
  const t = (key: GoalsCopyKey, values?: Record<string, string | number>) => goalsText(locale, key, values);
  const number = new Intl.NumberFormat(locale);
  let failure = ''; let data: Awaited<ReturnType<typeof readGoals>> | null = null;
  try { data = await readGoals({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); }
  catch (error) { failure = operationFailure(error, t('loadFailed')).error; }
  return <PageFrame module="analytics" scopedAccess sidebar={<WorkflowNav current="/analytics/goals" />}><div className={styles.root}>
    <header className={styles.heading}><p className={styles.eyebrow}>{t('eyebrow')}</p><h1>{t('title')}</h1>{data && <p>{t('subtitle', { from: data.month.start, to: data.month.end, zone: data.month.timeZone })}</p>}</header>
    {failure && <section className={styles.panel} role="alert"><h2>{t('loadFailedTitle')}</h2><p>{failure}</p><a href="/analytics/goals">{t('retry')}</a></section>}
    {data && !data.channels.length && <section className={styles.panel}><h2>{t('noChannelsTitle')}</h2><p>{t('noChannels')}</p><a href="/settings/connections">{t('manageConnections')}</a></section>}
    {data?.channels.map(channel => <section key={channel.channelId} className={styles.panel} aria-labelledby={`goal-${channel.channelId}`}>
      <h2 id={`goal-${channel.channelId}`}>{channel.channelName}</h2>
      {channel.goals.length ? <div className={styles.tableWrap}><table><thead><tr><th scope="col">{t('goal')}</th><th scope="col">{t('target')}</th><th scope="col">{t('thisMonth')}</th><th scope="col">{t('progress')}</th><th scope="col">{t('pace')}</th></tr></thead><tbody>
        {channel.goals.map(g => <tr key={g.metric}><td>{goalMetricText(locale, g.metric)}</td><td>{number.format(g.target)}</td><td>{g.actual === null ? t('noData') : number.format(g.actual)}</td><td><progress max={100} value={g.percent} aria-label={`${goalMetricText(locale, g.metric)} ${g.percent}%`} /> {g.percent}%</td><td>{goalPaceText(locale, g.pace)}</td></tr>)}
      </tbody></table></div> : <p>{data.canManage ? t('none') : t('noneReadOnly')}</p>}
      {data.canManage && <GoalEditor locale={locale} channelId={channel.channelId} channelName={channel.channelName}
        metrics={channel.trackable.map(metric => ({ metric, label: goalMetricText(locale, metric), value: channel.goals.find(g => g.metric === metric)?.target ?? null }))} />}
    </section>)}
  </div></PageFrame>;
}
