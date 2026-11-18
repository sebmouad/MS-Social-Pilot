import { headers } from 'next/headers';
import Link from 'next/link';
import { OperationError } from '@/lib/operation-error';
import { PageHeader } from '@/components/PageHeader';
import { RouteNotice } from '@/components/RouteNotice';
import { MetricCard } from '@/components/MetricCard';
import { Sparkline } from '@/components/Sparkline';
import { requireViewer } from '@/server/context';
import { FEEDS_FEATURE_ID } from '../manifest';
import { feedsLocale } from '../copy';
import { autopilotCopy, autopilotText, type AutopilotCopyKey } from '../copy-autopilot';
import { readCockpit, approveDayConfirmation } from '../server/wordpress-cockpit';
import { AutopilotBoard } from './AutopilotBoard';
import { AutopilotDays } from './AutopilotDays';
import { logSentence } from '../autopilot-log';
import { recipeCopy, recipeText, type RecipeCopyKey } from '../copy-recipes';
import styles from './autopilot.module.css';

/**
 * Autopilot cockpit (2026-11-16): channels, tomorrow's plan to approve, and the weekly report.
 * 2026-11-17: opens on what needs a look, then today as it happens; sections are reached from a pinned bar.
 */
export default async function AutopilotScreen() {
  const locale = feedsLocale((await headers()).get('accept-language'));
  const t = (key: AutopilotCopyKey, values: Record<string, string | number> = {}) => autopilotText(locale, key, values);
  const viewer = await requireViewer({ feature: FEEDS_FEATURE_ID, channelScoped: true });
  const actions = <><Link className="ui-button ui-button--quiet" href="/content/feeds">{t('recipes')}</Link><Link className="ui-button ui-button--secondary" href="/content/feeds#autopilot">{t('settings')}</Link></>;
  const heading = <PageHeader module="publishing" title={t('title')} description={t('description')} actions={actions} />;
  let view;
  try { view = await readCockpit({ userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: [...viewer.permissions.pageScope.ids] }) }); }
  catch (error) {
    return <>{heading}<RouteNotice error={!(error instanceof OperationError && error.code === 'not_found')} focusKey="autopilot-load">{error instanceof OperationError && error.code === 'not_found' ? t('noAccess') : t('loadFailed')}</RouteNotice></>;
  }
  const number = (value: number) => new Intl.NumberFormat(locale).format(Math.round(value));
  const times = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
  const compact = (value: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const dateLabel = (date: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const percent = (now: number, before: number) => before > 0 ? (now - before) / before * 100 : null;
  /** A change past ten times the week before reads « ×12 » (2026-11-17): « +6 815 % » said nothing more. */
  const trendText = (now: number, before: number) => before > 0 && now / before >= 10 ? `×${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(now / before)}` : signed((now - before) / before * 100);
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0 }).format(value)} %`;
  const report = view.report;
  const change = percent(report.reach, report.previousReach);
  const next = view.channels.flatMap(channel => channel.next ? [channel.next] : []).sort((a, b) => a.slotAt.localeCompare(b.slotAt))[0];
  const boardLabels = Object.fromEntries((['approveAll', 'approved', 'approveTitle', 'approveObject', 'approveConsequence', 'approveDone', 'approveFailed', 'cancel', 'showFlagged', 'showAll', 'emptyTomorrow', 'emptyToday', 'another', 'leaveEmpty', 'open', 'leftEmpty',
    'anotherTitle', 'anotherConsequence', 'emptyTitle', 'emptyConsequence', 'fill', 'fillTitle', 'fillConsequence', 'changed', 'changeFailed', 'scoreLabel', 'flaggedHint', 'groupBy', 'byTime', 'byChannel', 'now', 'view', 'more', 'failed', 'publishedReach', 'publishedNoReach', 'showEvery', 'showFewer',
    'kind_dessert', 'kind_main', 'kind_starter', 'kind_drink', 'kind_aperitif', 'kind_bread', 'kind_side', 'kind_breakfast', 'kind_sauce'] as const).map(key => [key, autopilotText(locale, key)])) as Record<string, string>;

  const today = view.today.posts;
  const live = today.filter(post => post.status === 'published');
  const toCome = today.filter(post => post.status === 'upcoming');
  const failedToday = today.filter(post => post.status === 'failed');
  const reachToday = live.reduce((sum, post) => sum + (post.reach ?? 0), 0);
  const planned = view.tomorrow.posts.filter(post => post.status === 'upcoming');
  const failedWeek = view.channels.reduce((sum, channel) => sum + channel.failedWeek, 0);
  const idle = view.enabled ? view.channels.filter(channel => !channel.paused && !channel.next) : [];
  // What needs a look, most pressing first; each line leads to where it is settled.
  const logTime = (at: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: view.timeZone }).format(new Date(at));
  const reasonOf = (reason: string | null) => { const key = reason ? `reason${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : ''; return key && key in recipeCopy[locale] ? recipeText(locale, key as RecipeCopyKey) : ''; };
  const attention: Array<{ key: string; tone: 'warn' | 'info'; text: string; href: string; action: string }> = [
    ...(!view.enabled ? [{ key: 'source', tone: 'warn' as const, text: t('sourcePaused'), href: '/content/feeds', action: t('attentionResume') }] : []),
    ...view.channels.filter(channel => channel.paused).map(channel => ({ key: `paused-${channel.id}`, tone: 'warn' as const, text: t(channel.pausedReason ? 'attentionHeld' : 'attentionPaused', { channel: channel.name }), href: channel.pausedReason ? '/settings/channels' : '/content/feeds#settings', action: t(channel.pausedReason ? 'attentionChannels' : 'attentionSettings') })),
    // Each recent failure by name, with why and where to open it; any beyond those shown are counted on one line.
    ...view.failures.map(failure => ({ key: `failure-${failure.planId}`, tone: 'warn' as const,
      text: t('attentionFailedPost', { title: failure.title, channel: failure.targetName, when: logTime(failure.slotAt) }) + (reasonOf(failure.reason) ? ` ${reasonOf(failure.reason)}.` : ''),
      href: failure.postId ? `/content/post/${encodeURIComponent(failure.postId)}` : '/content/feeds#plans', action: t(failure.postId ? 'attentionOpen' : 'attentionSee') })),
    ...(failedWeek > view.failures.length ? [{ key: 'failed', tone: 'warn' as const, text: t('attentionFailedMore', { count: failedWeek - view.failures.length }), href: '/content/feeds#plans', action: t('attentionSee') }] : []),
    ...(idle.length ? [{ key: 'idle', tone: 'info' as const, text: t('attentionIdle', { channels: idle.map(channel => channel.name).join(', ') }), href: '/content/feeds', action: t('attentionSee') }] : []),
    ...(view.tomorrow.flagged ? [{ key: 'flagged', tone: 'info' as const, text: view.tomorrow.flagged === 1 ? t('attentionFlaggedOne') : t('attentionFlagged', { count: view.tomorrow.flagged }), href: '#tomorrow', action: t('attentionReview') }] : []),
    ...(planned.length && !view.tomorrow.approved && view.canWrite ? [{ key: 'approve', tone: 'info' as const, text: t('attentionApprove', { count: planned.length }), href: '#tomorrow', action: t('attentionReview') }] : []),
  ];
  const topReach = Math.max(1, ...report.channels.map(row => row.reach));
  const styleRows = Object.entries(report.styles).sort((a, b) => b[1].average - a[1].average);
  const topStyle = Math.max(0.01, ...styleRows.map(([, stat]) => stat.average));
  const logRow = (entry: (typeof report.learned)[number], index: number) => <li key={`${entry.at}-${index}`} data-kind={entry.kind}>
          <span className={styles.logKind}>{t(`log_${entry.kind}` as AutopilotCopyKey)}</span>
          <div><strong>{entry.channelName ?? ''}</strong>
            <span>{entry.kind === 'times' ? <>{t('timesMoved')} <s>{(entry.from ?? []).join(' · ')}</s> → {(entry.to ?? []).join(' · ')}</> : logSentence(entry, locale)}</span></div>
          <time dateTime={entry.at}>{logTime(entry.at)}</time>
        </li>;
  const sections: Array<[string, string]> = [['plan', t('planHeading')], ['channels', t('channelsHeading')], ['report', t('reportHeading')], ['activity', t('navActivity')], ...(view.ai ? [['ai', t('navAi')] as [string, string]] : [])];

  return <>
    {heading}
    <div className={styles.page}>
      <section className={styles.hero} aria-label={t('title')}>
        <div className={styles.heroHead}>
          <span className={styles.state} data-on={view.enabled ? 'true' : 'false'}>{view.enabled ? t('on') : t('off')}</span>
          <span>{view.sourceName} · {t('channels', { count: view.channels.length })}</span>
          {next && view.enabled ? <span className={styles.heroNext}>{t('nextAt', { time: next.time })} · <strong>{next.title}</strong> · {next.targetName}</span> : null}
        </div>
        <dl className={styles.heroStats}>
          <div><dt>{t('statToday')}</dt><dd>{live.length}<small> / {live.length + toCome.length}</small></dd><span>{failedToday.length ? <span className={styles.warn}>{failedToday.length === 1 ? t('statFailedOne') : t('statFailed', { count: failedToday.length })}</span> : toCome.length ? t('statToCome', { count: toCome.length }) : t('statDayDone')}</span></div>
          <div><dt>{t('statReachToday')}</dt><dd>{number(reachToday)}</dd><span>{!live.length ? t('statNoneLive') : reachToday ? t('statPerPost', { reach: number(reachToday / live.length) }) : t('statNotMeasured')}</span></div>
          <div><dt>{t('statTomorrow')}</dt><dd>{planned.length}</dd><span>{!planned.length ? t('statNotPlanned') : view.tomorrow.approved ? t('approved') : view.tomorrow.flagged ? <span className={styles.warn}>{t('flagged', { count: view.tomorrow.flagged })}</span> : t('statToReview')}</span></div>
          <div><dt>{t('statWeek')}</dt><dd>{compact(report.reach)}</dd><span>{change !== null ? <><span className={styles.delta} data-direction={change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat'}>{trendText(report.reach, report.previousReach)}</span> {t('vsPrevious')}</> : t('statFirstWeek')}</span></div>
        </dl>
      </section>

      {attention.length ? <section className={styles.attention} aria-labelledby="ap-attention">
        <h2 id="ap-attention">{t('attentionHeading')} <span>{attention.length}</span></h2>
        <ul>{attention.map(item => <li key={item.key} data-tone={item.tone}><span>{item.text}</span><Link href={item.href}>{item.action}</Link></li>)}</ul>
      </section> : <p className={styles.allGood}>{t('allGood')}</p>}

      <nav className={styles.nav} aria-label={t('navLabel')}>{sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>

      <section id="plan" aria-labelledby="ap-plan" className={styles.section}>
        <h2 id="ap-plan">{t('planHeading')}</h2>
        <AutopilotDays label={t('planHeading')} initial={toCome.length || !view.tomorrow.posts.length ? 'today' : 'tomorrow'} days={[
          { id: 'today', label: t('todayHeading', { date: dateLabel(view.today.date) }), count: today.length, content: <div className={styles.day}>
            {today.length ? <p className={styles.summary}>{t('todaySummary', { live: live.length, coming: toCome.length })}{reachToday ? <> · {t('reachToday', { reach: number(reachToday) })}</> : null}
              {failedToday.length ? <> · <span className={styles.warn}>{failedToday.length === 1 ? t('statFailedOne') : t('statFailed', { count: failedToday.length })}</span></> : null}</p> : null}
            <AutopilotBoard mode="today" date={view.today.date} dateLabel={dateLabel(view.today.date)} posts={today} canWrite={view.canWrite} locale={locale} labels={boardLabels} /></div> },
          { id: 'tomorrow', label: t('tomorrowHeading', { date: dateLabel(view.tomorrow.date) }), count: view.tomorrow.posts.length, content: <div className={styles.day}>
            {view.tomorrow.posts.length ? <p className={styles.summary}>{t('tomorrowSummary', { count: planned.length, channels: new Set(planned.map(post => post.targetId)).size })}
              {view.tomorrow.averageScore !== null ? <> · {t('averageScore', { score: view.tomorrow.averageScore })}</> : null}
              {view.tomorrow.flagged ? <> · <span className={styles.warn}>{t('flagged', { count: view.tomorrow.flagged })}</span></> : null}</p> : null}
            <AutopilotBoard mode="tomorrow" date={view.tomorrow.date} dateLabel={dateLabel(view.tomorrow.date)} posts={view.tomorrow.posts} approved={view.tomorrow.approved} canWrite={view.canWrite}
              confirmation={approveDayConfirmation(view.tomorrow.date)} locale={locale} labels={boardLabels} /></div> },
        ]} />
      </section>

      <section id="channels" aria-labelledby="ap-channels" className={styles.section}>
        <h2 id="ap-channels">{t('channelsHeading')} <span className={styles.muted}>{t('reportRange')}</span></h2>
        <ul className={styles.channels}>{view.channels.map(channel => { const trend = percent(channel.weekReach, channel.previousReach); return <li key={channel.id} className={styles.channel} data-paused={channel.paused ? 'true' : undefined}>
          <div className={styles.channelHead}><strong>{channel.name}</strong>
            <span className={styles.badge} data-tone={channel.paused ? 'warn' : channel.autoTimes ? 'accent' : undefined}>{channel.paused ? t(channel.pausedReason ? 'held' : 'paused') : channel.autoTimes ? t('autoTimes') : t('sharedTimes')}</span></div>
          <div className={styles.channelReach}>
            <div><span className={styles.channelFigure}>{compact(channel.weekReach)}</span> <span className={styles.meta}>{t('reachedWeek')}</span>
              {trend !== null ? <span className={styles.delta} data-direction={trend > 0.5 ? 'up' : trend < -0.5 ? 'down' : 'flat'}>{trendText(channel.weekReach, channel.previousReach)}</span> : null}</div>
            {channel.daily.some(value => value > 0) ? <Sparkline data={channel.daily} width={96} height={28} label={t('sparkLabel', { channel: channel.name })} /> : null}
          </div>
          <p className={styles.meta}>{channel.weekPosts === 1 ? t('postsWeekOne') : t('postsWeek', { count: channel.weekPosts })}{channel.failedWeek ? <> · <span className={styles.warn}>{channel.failedWeek === 1 ? t('failedWeekOne') : t('failedWeek', { count: channel.failedWeek })}</span></> : null}</p>
          {channel.learned ? <div className={styles.learned}>
            <span className={styles.learnedHead}>{t('learnedTitle')} <span>{t('learnedFrom', { count: number(channel.learned.posts) })}</span></span>
            {channel.learned.best.length || channel.learned.worst.length || channel.learned.hours.length || channel.learned.photos.length || channel.learned.formats.length > 1 || channel.learned.tips.length || channel.learned.style ? <>
              {channel.learned.best.length ? <p><b>{t('worksHere')}</b> {channel.learned.best.map(item => `${item.word} ×${times(item.times)}`).join(' · ')}</p> : null}
              {channel.learned.worst.length ? <p><b>{t('lessHere')}</b> {channel.learned.worst.map(item => `${item.word} ×${times(item.times)}`).join(' · ')}</p> : null}
              {channel.learned.hours.length ? <p><b>{t('hoursHere')}</b> {channel.learned.hours.map(item => `${String(item.hour).padStart(2, '0')} h ×${times(item.times)}`).join(' · ')}</p> : null}
              {channel.learned.formats.length > 1 ? <p><b>{t('formatsHere')}</b> {channel.learned.formats.map(item => `${t(`format_${item.format}` as AutopilotCopyKey)} ×${times(item.times)}`).join(' · ')}</p> : null}
              {(() => { const app = channel.learned.origins.find(o => o.origin === 'app'); const other = channel.learned.origins.find(o => o.origin === 'external'); return app && other ? <p><b>{t('originHere')}</b> {t('originVs', { times: times(app.times / other.times) })}</p> : null; })()}
              {channel.learned.photos.length ? <p><b>{t('photosHere')}</b> {channel.learned.photos.map(item => `${t(`trait_${item.trait}` as AutopilotCopyKey)} ×${times(item.times)}`).join(' · ')}</p> : null}
              {channel.learned.tips.length || channel.learned.style ? <p><b>{t('captionsHere')}</b> {[...channel.learned.tips.map(tip => t(`tip_${tip.code}` as AutopilotCopyKey)), ...(channel.learned.style ? [`${t('styleHere').toLowerCase()} « ${t(`style_${channel.learned.style}` as AutopilotCopyKey).toLowerCase()} »`] : [])].join(' · ')}</p> : null}
            </> : <p className={styles.muted}>{t('noLessons')}</p>}
          </div> : null}
          <div className={styles.channelFoot}>
            <span className={styles.times}>{channel.times.join(' · ')}</span>
            {channel.next ? <p className={styles.next}><span>{t('next')} {channel.next.time}</span> {channel.next.title}</p> : <p className={styles.muted}>{channel.paused ? t('noNextPaused') : t('noNext')}</p>}
          </div>
        </li>; })}</ul>
      </section>

      <section id="report" aria-labelledby="ap-report" className={styles.section}>
        <h2 id="ap-report">{t('reportHeading')} <span className={styles.muted}>{t('reportRange')}</span></h2>
        <div className={styles.metrics}>
          <MetricCard module="publishing" label={t('published')} value={number(report.published)} />
          <MetricCard module="publishing" label={t('reached')} value={number(report.reach)} {...(change !== null ? { delta: { label: signed(change), direction: change > 0.5 ? 'up' as const : change < -0.5 ? 'down' as const : 'flat' as const, comparedTo: t('vsPrevious') } } : {})} />
          <MetricCard module="publishing" label={t('bestRecipe')} value={report.best ? number(report.best.reach) : t('none')} hint={report.best ? `${report.best.title} · ${report.best.channel}` : undefined} />
          <MetricCard module="publishing" label={t('bestHour')} value={report.bestHour !== null ? `${String(report.bestHour).padStart(2, '0')}:00` : t('none')} />
        </div>
        <div className={styles.columns}>
          <div className={styles.card}><h3>{t('perChannel')}</h3>
            <ul className={styles.bars}>{[...report.channels].sort((a, b) => b.reach - a.reach).map(row => <li key={row.id}>
              <div className={styles.barHead}><strong>{row.name}</strong><span>{number(row.reach)}</span></div>
              <div className={styles.bar} aria-hidden="true"><span style={{ width: `${Math.max(row.reach ? 2 : 0, row.reach / topReach * 100)}%` }} /></div>
              <span className={styles.meta}>{row.posts === 1 ? t('postsWeekOne') : t('postsWeek', { count: row.posts })}{row.best ? ` · ${t('bestOf', { title: row.best.title, reach: number(row.best.reach) })}` : ''}</span>
            </li>)}</ul>
          </div>
          <div className={styles.card}><h3>{t('stylesHeading')}</h3>
            {styleRows.length ? <><ul className={styles.bars}>{styleRows.map(([style, stat]) => <li key={style}>
              <div className={styles.barHead}><strong>{t(`style_${style}` as AutopilotCopyKey)}{report.preferredStyle === style ? <span className={styles.badge} data-tone="accent">{t('preferred')}</span> : null}</strong><span>{signed((stat.average - 1) * 100)}</span></div>
              <div className={styles.bar} aria-hidden="true"><span style={{ width: `${Math.max(2, stat.average / topStyle * 100)}%` }} /></div>
              <span className={styles.meta}>{stat.posts === 1 ? t('postsWeekOne') : t('postsWeek', { count: stat.posts })}</span>
            </li>)}</ul><p className={styles.meta}>{t('stylesHint')}</p></> : <p className={styles.muted}>{t('stylesEmpty')}</p>}
          </div>
        </div>
      </section>

      <section id="activity" aria-labelledby="ap-activity" className={styles.section}>
        <h2 id="ap-activity">{t('learnedHeading')} <span className={styles.muted}>{t('reportRange')}</span></h2>
        {report.learned.length ? <>
          <ul className={styles.log}>{report.learned.slice(0, 6).map(logRow)}</ul>
          {report.learned.length > 6 ? <details className={styles.more}><summary>{t('logMore', { count: report.learned.length - 6 })}</summary><ul className={styles.log}>{report.learned.slice(6).map(logRow)}</ul></details> : null}
        </> : <p className={styles.emptyBox}>{t('learnedEmpty')}</p>}
      </section>

      {view.ai ? <section id="ai" aria-labelledby="ap-ai" className={styles.section}>
        <h2 id="ap-ai">{t('aiHeading')}{view.ai.model ? <span className={styles.muted}>{t('aiModel', { model: view.ai.model })}</span> : null}</h2>
        {view.ai.requests ? <>
        <div className={styles.metrics}>
          <MetricCard module="publishing" label={t('aiRequests')} value={number(view.ai.requests)} />
          <MetricCard module="publishing" label={t('aiTokens')} value={number(view.ai.inputTokens + view.ai.outputTokens)} hint={t('aiInOut', { input: number(view.ai.inputTokens), output: number(view.ai.outputTokens) })} />
          <MetricCard module="publishing" label={t('aiCost')} value={view.ai.costUsd !== null ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(view.ai.costUsd) : t('none')} hint={view.ai.costUsd === null ? t('aiUnpriced') : undefined} />
          <MetricCard module="publishing" label={t('aiPeak')} value={view.ai.hourlyLimit ? t('aiPeakValue', { count: view.ai.peakHour, limit: view.ai.hourlyLimit }) : number(view.ai.peakHour)} hint={t('aiPeakHint')} />
        </div>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th scope="col">{t('colUse')}</th><th scope="col">{t('colRequests')}</th><th scope="col">{t('aiTokens')}</th></tr></thead>
          <tbody>{view.ai.byKind.map(row => <tr key={row.kind}><th scope="row">{(`use_${row.kind}` in autopilotCopy[locale]) ? t(`use_${row.kind}` as AutopilotCopyKey) : row.kind}</th><td>{number(row.requests)}</td><td>{number(row.inputTokens + row.outputTokens)}</td></tr>)}</tbody>
        </table></div></> : <p className={styles.emptyBox}>{t('aiEmpty')}</p>}
      </section> : null}
    </div>
  </>;
}
