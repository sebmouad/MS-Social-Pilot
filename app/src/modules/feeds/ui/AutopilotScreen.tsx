import { headers } from 'next/headers';
import Link from 'next/link';
import { OperationError } from '@/lib/operation-error';
import { PageHeader } from '@/components/PageHeader';
import { RouteNotice } from '@/components/RouteNotice';
import { MetricCard } from '@/components/MetricCard';
import { requireViewer } from '@/server/context';
import { FEEDS_FEATURE_ID } from '../manifest';
import { feedsLocale } from '../copy';
import { autopilotText, type AutopilotCopyKey } from '../copy-autopilot';
import { readCockpit, approveDayConfirmation } from '../server/wordpress-cockpit';
import { AutopilotBoard } from './AutopilotBoard';
import styles from './autopilot.module.css';

/** Autopilot cockpit (2026-11-16): channels, tomorrow's plan to approve, and the weekly report. */
export default async function AutopilotScreen() {
  const locale = feedsLocale((await headers()).get('accept-language'));
  const t = (key: AutopilotCopyKey, values: Record<string, string | number> = {}) => autopilotText(locale, key, values);
  const viewer = await requireViewer({ feature: FEEDS_FEATURE_ID, channelScoped: true });
  const actions = <Link className="ui-button ui-button--secondary" href="/content/feeds#autopilot">{t('settings')}</Link>;
  const heading = <PageHeader module="publishing" title={t('title')} description={t('description')} actions={actions} />;
  let view;
  try { view = await readCockpit({ userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: [...viewer.permissions.pageScope.ids] }) }); }
  catch (error) {
    return <>{heading}<RouteNotice error={!(error instanceof OperationError && error.code === 'not_found')} focusKey="autopilot-load">{error instanceof OperationError && error.code === 'not_found' ? t('noAccess') : t('loadFailed')}</RouteNotice></>;
  }
  const number = (value: number) => new Intl.NumberFormat(locale).format(Math.round(value));
  const dateLabel = (date: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const report = view.report;
  const change = report.previousReach > 0 ? (report.reach - report.previousReach) / report.previousReach * 100 : null;
  const next = view.channels.flatMap(channel => channel.next ? [channel.next] : []).sort((a, b) => a.slotAt.localeCompare(b.slotAt))[0];
  const boardLabels = Object.fromEntries((['approveAll', 'approved', 'approveTitle', 'approveObject', 'approveConsequence', 'approveDone', 'approveFailed', 'cancel', 'showFlagged', 'showAll', 'emptyTomorrow', 'another', 'leaveEmpty', 'open', 'leftEmpty',
    'anotherTitle', 'anotherConsequence', 'emptyTitle', 'emptyConsequence', 'changed', 'changeFailed', 'scoreLabel', 'flaggedHint',
    'kind_dessert', 'kind_main', 'kind_starter', 'kind_drink', 'kind_aperitif', 'kind_bread', 'kind_side', 'kind_breakfast', 'kind_sauce'] as const).map(key => [key, autopilotText(locale, key)])) as Record<string, string>;

  return <>
    {heading}
    <div className={styles.page}>
      <section className={styles.status} aria-label={t('title')}>
        <span className={styles.state} data-on={view.enabled ? 'true' : 'false'}>{view.enabled ? t('on') : t('off')}</span>
        <span>{view.sourceName}</span>
        <span>{t('channels', { count: view.channels.length })}</span>
        {next ? <span>{t('nextAt', { time: next.time })} · {next.targetName}</span> : null}
      </section>
      {!view.enabled ? <RouteNotice focusKey="autopilot-paused">{t('sourcePaused')}</RouteNotice> : null}

      <section aria-labelledby="ap-channels" className={styles.section}>
        <h2 id="ap-channels">{t('channelsHeading')}</h2>
        <ul className={styles.channels}>{view.channels.map(channel => <li key={channel.id} className={styles.channel} data-paused={channel.paused ? 'true' : undefined}>
          <div className={styles.channelHead}><strong>{channel.name}</strong>
            <span className={styles.badge} data-tone={channel.paused ? 'warn' : channel.autoTimes ? 'accent' : undefined}>{channel.paused ? t('paused') : channel.autoTimes ? t('autoTimes') : t('sharedTimes')}</span></div>
          <span className={styles.times}>{channel.times.join(' · ')}</span>
          {channel.next ? <p className={styles.next}><span>{t('next')} {channel.next.time}</span> {channel.next.title}{typeof channel.next.score === 'number' ? <span className={styles.score} data-band={channel.next.score >= 70 ? 'high' : channel.next.score >= 45 ? 'mid' : 'low'}>{channel.next.score}</span> : null}</p> : <p className={styles.muted}>{t('noNext')}</p>}
          <p className={styles.meta}>{t('reachToday', { reach: number(channel.reachToday) })} · {t('postsToday', { count: channel.postsToday })}{channel.failedWeek ? <> · <span className={styles.warn}>{t('failedWeek', { count: channel.failedWeek })}</span></> : null}</p>
        </li>)}</ul>
      </section>

      <section id="tomorrow" aria-labelledby="ap-tomorrow" className={styles.section}>
        <h2 id="ap-tomorrow">{t('tomorrowHeading', { date: dateLabel(view.tomorrow.date) })}</h2>
        <p className={styles.summary}>{t('tomorrowSummary', { count: view.tomorrow.posts.filter(post => post.state === 'planned').length, channels: new Set(view.tomorrow.posts.map(post => post.targetId)).size })}
          {view.tomorrow.averageScore !== null ? <> · {t('averageScore', { score: view.tomorrow.averageScore })}</> : null}
          {view.tomorrow.flagged ? <> · <span className={styles.warn}>{t('flagged', { count: view.tomorrow.flagged })}</span></> : null}</p>
        <AutopilotBoard date={view.tomorrow.date} dateLabel={dateLabel(view.tomorrow.date)} posts={view.tomorrow.posts} approved={view.tomorrow.approved} canWrite={view.canWrite}
          confirmation={approveDayConfirmation(view.tomorrow.date)} labels={boardLabels} />
      </section>

      <section id="report" aria-labelledby="ap-report" className={styles.section}>
        <h2 id="ap-report">{t('reportHeading')} <span className={styles.muted}>{t('reportRange')}</span></h2>
        <div className={styles.metrics}>
          <MetricCard module="publishing" label={t('published')} value={number(report.published)} />
          <MetricCard module="publishing" label={t('reached')} value={number(report.reach)} {...(change !== null ? { delta: { label: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`, direction: change > 0.5 ? 'up' as const : change < -0.5 ? 'down' as const : 'flat' as const, comparedTo: t('vsPrevious') } } : {})} />
          <MetricCard module="publishing" label={t('bestRecipe')} value={report.best ? number(report.best.reach) : t('none')} hint={report.best ? `${report.best.title} · ${report.best.channel}` : undefined} />
          <MetricCard module="publishing" label={t('bestHour')} value={report.bestHour !== null ? `${String(report.bestHour).padStart(2, '0')}:00` : t('none')} />
        </div>
        <div className={styles.tableWrap}><table className={styles.table}><caption>{t('perChannel')}</caption>
          <thead><tr><th scope="col">{t('colChannel')}</th><th scope="col">{t('colPosts')}</th><th scope="col">{t('colReach')}</th><th scope="col">{t('colBest')}</th></tr></thead>
          <tbody>{report.channels.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{number(row.posts)}</td><td>{number(row.reach)}</td><td>{row.best ? `${row.best.title} (${number(row.best.reach)})` : t('none')}</td></tr>)}</tbody>
        </table></div>
        <div className={styles.columns}>
          <div><h3>{t('learnedHeading')}</h3>
            {report.learned.length ? <ul className={styles.log}>{report.learned.map((entry, index) => <li key={`${entry.at}-${index}`}><time dateTime={entry.at}>{new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: view.timeZone }).format(new Date(entry.at))}</time>
              <span>{entry.kind === 'times' ? t('timesChanged', { channel: entry.channelName ?? '', from: (entry.from ?? []).join(' · '), to: (entry.to ?? []).join(' · ') }) : `${entry.channelName ? `${entry.channelName} — ` : ''}${entry.text ?? ''}`}</span></li>)}</ul>
              : <p className={styles.muted}>{t('learnedEmpty')}</p>}
          </div>
          <div><h3>{t('stylesHeading')}</h3>
            {Object.keys(report.styles).length ? <table className={styles.table}><thead><tr><th scope="col">{t('colStyle')}</th><th scope="col">{t('colPosts')}</th><th scope="col">{t('colAverage')}</th></tr></thead>
              <tbody>{Object.entries(report.styles).sort((a, b) => b[1].average - a[1].average).map(([style, stat]) => <tr key={style}><th scope="row">{t(`style_${style}` as AutopilotCopyKey)}{report.preferredStyle === style ? <span className={styles.badge} data-tone="accent">{t('preferred')}</span> : null}</th><td>{stat.posts}</td><td>{`${stat.average >= 1 ? '+' : ''}${Math.round((stat.average - 1) * 100)}%`}</td></tr>)}</tbody></table>
              : <p className={styles.muted}>{t('stylesEmpty')}</p>}
          </div>
        </div>
      </section>
    </div>
  </>;
}
