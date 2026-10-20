import type { ReactNode } from 'react';
import { IconArrowUpRight, IconCalendarEvent, IconChartBar, IconChartDonut, IconClockHour4, IconEye, IconHeart, IconInbox, IconSpeakerphone, IconUsers } from '@tabler/icons-react';
import { BarChart, DonutChart, HeatmapChart, Sparkline } from '@/components/charts';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getTargets } from '@/server/data';
import { canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { authLocale } from '@/modules/home/auth/locale';
import { fill, homeCopy } from '@/modules/home/copy';
import { readHomeOverview, type HomeOverview, type Section } from '@/modules/home/server/overview';
import type { ScheduleMode } from '@/modules/home/server/overview-pure';
import styles from './home.module.css';

type Copy = ReturnType<typeof homeCopy>;
type Module = 'analytics' | 'publishing' | 'inbox' | 'ads';
const HREF: Record<Module, string> = { analytics: '/analytics', publishing: '/publishing/posts', inbox: '/inbox', ads: '/ads' };

/** One card: icon chip tinted by its module color, a title and a link to the module. */
function Card({ module, icon, title, t, span, children, id }: { module: Module; icon: ReactNode; title: string; t: Copy; span: 'span4' | 'span6' | 'span8' | 'span12'; children: ReactNode; id: string }) {
  return <section className={`${styles.card} ${styles[span]}`} data-module={module} aria-labelledby={id}>
    <div className={styles.cardHead}>
      <span className={styles.chip} aria-hidden="true">{icon}</span>
      <h2 id={id}>{title}</h2>
      <a className={styles.open} href={HREF[module]} aria-label={fill(t.openModule, { name: t.moduleNames[module] })}>{t.moduleNames[module]} <IconArrowUpRight size={16} aria-hidden="true" /></a>
    </div>
    {children}
  </section>;
}

function Empty({ title, body, action, href }: { title: string; body: string; action: string; href: string }) {
  return <div className={styles.empty}><h3>{title}</h3><p>{body}</p><a className={styles.cta} href={href}>{action}</a></div>;
}

function Unavailable({ t }: { t: Copy }) {
  return <div className={styles.empty} role="status"><h3>{t.unavailableTitle}</h3><p>{t.unavailableBody}</p></div>;
}

/** A card body for a section state; `ready` content is supplied by the caller. */
function Body<T>({ section, t, empty, children }: { section: Section<T>; t: Copy; empty: ReactNode; children: (data: T) => ReactNode }) {
  return section.state === 'ready' ? <>{children(section.data)}</> : section.state === 'empty' ? <>{empty}</> : <Unavailable t={t} />;
}

function Delta({ change, t, days, locale }: { change: number | null; t: Copy; days: number; locale: string }) {
  if (change === null) return <span className={styles.delta}>{t.noComparison}</span>;
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(change));
  return <span className={styles.delta} data-direction={direction}>{sign}{percent} {fill(t.vsPrevious, { n: days })}</span>;
}

function Kpi({ title, icon, totals, overview, t, locale, id }: { title: string; icon: ReactNode; totals: NonNullable<Extract<HomeOverview['performance'], { state: 'ready' }>['data']>['views']; overview: HomeOverview; t: Copy; locale: string; id: string }) {
  const number = new Intl.NumberFormat(locale);
  return <Card module="analytics" icon={icon} title={title} t={t} span="span4" id={id}>
    <p className={styles.big}>{totals.current === null ? t.unknownFigure : number.format(totals.current)}</p>
    <Delta change={totals.change} t={t} days={overview.lookbackDays} locale={locale} />
    {totals.comparable > 0 && totals.comparable < totals.covered && <p className={styles.note}>{fill(t.comparableNote, { comparable: totals.comparable, covered: totals.covered })}</p>}
  </Card>;
}

const MODE_COPY: Record<ScheduleMode, 'modeApp' | 'modePlatform' | 'modeMixed'> = { app: 'modeApp', platform: 'modePlatform', mixed: 'modeMixed' };

export default async function HomePage() {
  const viewer = await requireViewer({ feature: 'home/overview' });
  const locale = await authLocale();
  const t = homeCopy(locale);
  const showConnections = canUseFeature(viewer.entitlements, 'settings/connections') && canAccessFeature(viewer.permissions, 'settings/connections', 'read');
  const scope = viewer.permissions.pageScope;
  const visibleTargets = await getTargets(viewer.workspaceId, scope.all ? undefined : scope.ids, entitledPlatformIds(viewer.entitlements));
  const overview = await readHomeOverview({ userId: viewer.user.id, workspaceId: viewer.workspaceId });
  const number = new Intl.NumberFormat(locale);
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const timeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: overview.timeZone });
  const dayLabel = (day: string) => { const date = new Date(`${day.slice(0, 10)}T12:00:00.000Z`); return Number.isNaN(date.getTime()) ? day : dayFormat.format(date); };
  const days = overview.lookbackDays;
  const performance = overview.performance;
  const ready = performance?.state === 'ready' ? performance.data : null;

  return <PageFrame module="home"><div className={styles.root}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>{t.eyebrow}</p><h1>{t.greeting}, {viewer.membership.workspace.name}</h1><p>{t.lead}</p></div>
      <span className={styles.period}>{fill(t.period, { n: days })}</span>
    </header>

    {showConnections && visibleTargets.length === 0 && <section className="panel home-start" aria-labelledby="home-start-title">
      <div><p className="eyebrow">{t.firstStep}</p><h2 id="home-start-title">{t.startTitle}</h2><p>{t.startBody}</p></div>
      <a className="home-start__action" href="/settings/connections">{t.startAction} <span aria-hidden="true">→</span></a>
    </section>}

    <div className={styles.grid}>
      {overview.audience && <Card module="analytics" icon={<IconUsers size={20} />} title={t.audience} t={t} span="span4" id="home-audience">
        <Body section={overview.audience} t={t} empty={<Empty title={t.audienceEmptyTitle} body={t.audienceEmptyBody} action={t.audienceEmptyAction} href={HREF.analytics} />}>
          {audience => <>
            <p className={styles.big}>{number.format(audience.total)}</p>
            <p className={styles.note}>{fill(t.audienceOf, { covered: audience.covered, selected: audience.selected })}{audience.asOf ? ` · ${fill(t.audienceAsOf, { date: dayFormat.format(new Date(audience.asOf)) })}` : ''}</p>
            {audience.trend.length > 1 && <Sparkline label={fill(t.audienceTrend, { n: days })} values={audience.trend.map(point => point.v)} labels={audience.trend.map(point => dayLabel(point.t))} area color={1} table={false} />}
            <p className={styles.note}>{t.audienceNote}</p>
          </>}
        </Body>
      </Card>}

      {performance && (ready ? <>
        <Kpi title={t.views} icon={<IconEye size={20} />} totals={ready.views} overview={overview} t={t} locale={locale} id="home-views" />
        <Kpi title={t.engagements} icon={<IconHeart size={20} />} totals={ready.engagements} overview={overview} t={t} locale={locale} id="home-engagements" />
      </> : <Card module="analytics" icon={<IconEye size={20} />} title={`${t.views} · ${t.engagements}`} t={t} span="span8" id="home-performance">
        <Body section={performance} t={t} empty={<Empty title={t.perfEmptyTitle} body={t.perfEmptyBody} action={t.perfEmptyAction} href={HREF.analytics} />}>{() => null}</Body>
      </Card>)}

      {performance && ready && <>
        <Card module="analytics" icon={<IconChartBar size={20} />} title={t.topChannels} t={t} span="span6" id="home-top">
          {ready.topChannels.length ? <BarChart label={fill(t.topChannelsLabel, { n: days })} locale={locale} orientation="horizontal" height={Math.max(160, ready.topChannels.length * 44)}
            categories={ready.topChannels.map(channel => channel.name)} series={[{ id: 'engagements', name: t.topChannelsSeries, values: ready.topChannels.map(channel => channel.engagements) }]} />
            : <p className={styles.note}>{t.topEmpty}</p>}
          <p className={styles.note}>{fill(t.channelsNote, { covered: ready.topChannels.length, channels: ready.channels })}{ready.truncated ? ` · ${fill(t.truncatedNote, { n: ready.channels })}` : ''}</p>
        </Card>
        <Card module="analytics" icon={<IconChartDonut size={20} />} title={t.interactions} t={t} span="span6" id="home-mix">
          {ready.interactions.length ? <DonutChart label={fill(t.interactionsLabel, { n: days })} locale={locale} totalLabel={t.interactionsTotal} slices={ready.interactions.map(item => ({ name: item.label, value: item.value }))} />
            : <p className={styles.note}>{t.interactionsEmpty}</p>}
        </Card>
      </>}

      {overview.bestTimes && <Card module="publishing" icon={<IconClockHour4 size={20} />} title={t.bestTimes} t={t} span="span8" id="home-times">
        <Body section={overview.bestTimes} t={t} empty={<Empty title={t.bestTimesEmptyTitle} body={t.bestTimesEmptyBody} action={t.bestTimesEmptyAction} href="/publishing/compose" />}>
          {times => <>
            <HeatmapChart label={t.bestTimesLabel} valueLabel={t.bestTimesValue} locale={locale} format={{ style: 'number', maximumFractionDigits: 2 }} cells={times.cells.map(cell => ({ day: cell.day, hour: cell.hour, value: cell.value }))} />
            <p className={styles.note}>{t.bestTimesNote}</p>
          </>}
        </Body>
      </Card>}

      {overview.upcoming && <Card module="publishing" icon={<IconCalendarEvent size={20} />} title={t.upcoming} t={t} span="span4" id="home-upcoming">
        <Body section={overview.upcoming} t={t} empty={<Empty title={t.upcomingEmptyTitle} body={t.upcomingEmptyBody} action={t.upcomingEmptyAction} href="/publishing/compose" />}>
          {upcoming => <>
            <ul className={styles.list}>{upcoming.items.map(item => <li className={styles.item} key={item.id}>
              <strong>{item.text || '—'}</strong>
              <span className={styles.meta}><time dateTime={item.scheduledAt}>{Number.isNaN(new Date(item.scheduledAt).getTime()) ? item.scheduledAt : timeFormat.format(new Date(item.scheduledAt))}</time><span className={styles.mode}>{t[MODE_COPY[item.mode]]}</span></span>
              <span className={styles.meta}>{item.channels.join(', ')}</span>
            </li>)}</ul>
            {upcoming.total > upcoming.items.length && <p className={styles.note}>{fill(t.upcomingMore, { n: upcoming.total })}</p>}
            <a className={styles.link} href="/publishing/queue">{t.viewQueue}</a>
          </>}
        </Body>
      </Card>}

      {overview.inbox && <Card module="inbox" icon={<IconInbox size={20} />} title={t.inbox} t={t} span="span4" id="home-inbox">
        <Body section={overview.inbox} t={t} empty={null}>
          {inbox => <>
            <p className={styles.big}>{number.format(inbox.open)}</p>
            <p className={styles.note}>{inbox.open > 0 ? t.inboxOpen : t.inboxZero}</p>
            <a className={styles.link} href={HREF.inbox}>{t.inboxAction}</a>
          </>}
        </Body>
      </Card>}

      {overview.ads && <Card module="ads" icon={<IconSpeakerphone size={20} />} title={t.adSpend} t={t} span="span4" id="home-ads">
        <Body section={overview.ads} t={t} empty={<Empty title={t.adsEmptyTitle} body={t.adsEmptyBody} action={t.adsEmptyAction} href={HREF.ads} />}>
          {ads => <>
            {ads.spend.map(group => <div key={group.currency ?? 'none'}>
              <p className={styles.big}>{new Intl.NumberFormat(locale, group.currency ? { style: 'currency', currency: group.currency } : undefined).format(group.total)}</p>
              {ads.spend.length === 1 && group.daily.length > 1 && <Sparkline label={fill(t.adSpendTrend, { n: days })} values={group.daily.map(day => day.v)} labels={group.daily.map(day => dayLabel(day.t))} area color={4} table={false} />}
            </div>)}
            <p className={styles.note}>{fill(t.adSpendNote, { n: days })}</p>
          </>}
        </Body>
      </Card>}
    </div>
  </div></PageFrame>;
}
