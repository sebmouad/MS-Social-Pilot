import type { ReactNode } from 'react';
import { IconArrowUpRight, IconCalendarEvent, IconChartBar, IconChartDonut, IconClockHour4, IconEye, IconHeart, IconInbox, IconPlugConnected, IconSpeakerphone, IconUsers } from '@tabler/icons-react';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, type MetricDelta } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { PostThumb } from '@/components/PostThumb';
import type { PostThumbnail } from '@/components/post-thumbnail';
import { BarChart, DonutChart, HeatmapChart } from '@/components/charts';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getTargets } from '@/server/data';
import { canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { authLocale } from '@/modules/home/auth/locale';
import { fill, type HomeCopy } from '@/modules/home/copy';
import { loadHomeCopy } from '@/modules/home/server/copy';
import { readHomeOverview, type HomeOverview, type Section } from '@/modules/home/server/overview';
import type { ScheduleMode } from '@/modules/home/server/overview-pure';
import styles from './home.module.css';

type Copy = HomeCopy;
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

const CTA = 'ui-button ui-button--primary ui-button--md';

function Empty({ title, body, action, href }: { title: string; body: string; action: string; href: string }) {
  return <EmptyState title={title} action={<a className={CTA} href={href}><span>{action}</span></a>}>{body}</EmptyState>;
}

function Unavailable({ t }: { t: Copy }) {
  return <EmptyState tone="error" title={t.unavailableTitle}>{t.unavailableBody}</EmptyState>;
}

/** A card body for a section state; `ready` content is supplied by the caller. */
function Body<T>({ section, t, empty, children }: { section: Section<T>; t: Copy; empty: ReactNode; children: (data: T) => ReactNode }) {
  return section.state === 'ready' ? <>{children(section.data)}</> : section.state === 'empty' ? <>{empty}</> : <Unavailable t={t} />;
}

function deltaOf(change: number | null, t: Copy, days: number, locale: string): MetricDelta | undefined {
  if (change === null) return undefined;
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(change));
  return { label: `${sign}${percent}`, direction, comparedTo: fill(t.vsPrevious, { n: days }) };
}

/** Grid cell holding one KPI card and the link to its module. */
function Tile({ span, children, href, linkLabel, module }: { span: 'span4' | 'span6' | 'span8'; children: ReactNode; href: string; linkLabel: string; module: Module }) {
  return <div className={`${styles.tile} ${styles[span]}`} data-module={module}>{children}<a className={styles.link} href={href}>{linkLabel} <IconArrowUpRight size={14} aria-hidden="true" /></a></div>;
}

function Kpi({ title, icon, totals, overview, t, locale }: { title: string; icon: ReactNode; totals: NonNullable<Extract<HomeOverview['performance'], { state: 'ready' }>['data']>['views']; overview: HomeOverview; t: Copy; locale: string }) {
  const number = new Intl.NumberFormat(locale);
  const delta = deltaOf(totals.change, t, overview.lookbackDays, locale);
  const partial = totals.comparable > 0 && totals.comparable < totals.covered;
  return <Tile module="analytics" span="span4" href={HREF.analytics} linkLabel={fill(t.openModule, { name: t.moduleNames.analytics })}>
    <MetricCard module="analytics" icon={icon} label={title} value={totals.current === null ? null : number.format(totals.current)} unavailable={totals.current === null ? t.unknownFigure : undefined} delta={delta}
      hint={<>{fill(t.channelsNote, { covered: totals.covered, channels: overview.channelCount })}<br />{!delta ? t.noComparison : partial ? fill(t.comparableNote, { comparable: totals.comparable, covered: totals.covered }) : undefined}</>} />
  </Tile>;
}

const MODE_COPY: Record<ScheduleMode, 'modeApp' | 'modePlatform' | 'modeMixed'> = { app: 'modeApp', platform: 'modePlatform', mixed: 'modeMixed' };

export default async function HomePage() {
  const viewer = await requireViewer({ feature: 'home/overview' });
  const locale = await authLocale();
  const t = await loadHomeCopy(locale);
  const showConnections = canUseFeature(viewer.entitlements, 'settings/connections') && canAccessFeature(viewer.permissions, 'settings/connections', 'read');
  const scope = viewer.permissions.pageScope;
  const visibleTargets = await getTargets(viewer.workspaceId, scope.all ? undefined : scope.ids, entitledPlatformIds(viewer.entitlements));
  const overview = await readHomeOverview({ userId: viewer.user.id, workspaceId: viewer.workspaceId });
  const number = new Intl.NumberFormat(locale);
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const timeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: overview.timeZone });
  const days = overview.lookbackDays;
  const performance = overview.performance;
  const ready = performance?.state === 'ready' ? performance.data : null;
  const readyAds = overview.ads?.state === 'ready' ? overview.ads.data : null;

  return <PageFrame module="home"><div className={styles.root}>
    <PageHeader module="home" title={`${t.greeting}, ${viewer.membership.workspace.name}`} description={t.lead}
      actions={<Badge tone="module" module="home" icon={<IconCalendarEvent size={14} />}>{fill(t.period, { n: days })}</Badge>} />

    {showConnections && visibleTargets.length === 0 && <EmptyState icon={<IconPlugConnected size={22} />} title={t.startTitle} action={<a className={CTA} href="/settings/connections"><span>{t.startAction}</span></a>}>{t.startBody}</EmptyState>}

    <div className={styles.grid}>
      {overview.audience && (overview.audience.state === 'ready'
        ? <Tile module="analytics" span="span4" href={HREF.analytics} linkLabel={fill(t.openModule, { name: t.moduleNames.analytics })}>
          <MetricCard module="analytics" icon={<IconUsers size={20} />} label={t.audience} value={number.format(overview.audience.data.total)}
            hint={<>{fill(t.audienceOf, { covered: overview.audience.data.covered, selected: overview.audience.data.selected })}{overview.audience.data.asOf ? ` · ${fill(t.audienceAsOf, { date: dayFormat.format(new Date(overview.audience.data.asOf)) })}` : ''}<br />{t.audienceNote}</>}
            sparkline={overview.audience.data.trend.length > 1 ? overview.audience.data.trend.map(point => point.v) : undefined} sparklineLabel={fill(t.audienceTrend, { n: days })} />
        </Tile>
        : <Card module="analytics" icon={<IconUsers size={20} />} title={t.audience} t={t} span="span4" id="home-audience">
          <Body section={overview.audience} t={t} empty={<Empty title={t.audienceEmptyTitle} body={t.audienceEmptyBody} action={t.audienceEmptyAction} href={HREF.analytics} />}>{() => null}</Body>
        </Card>)}

      {performance && (ready ? <>
        <Kpi title={t.views} icon={<IconEye size={20} />} totals={ready.views} overview={overview} t={t} locale={locale} />
        <Kpi title={t.engagements} icon={<IconHeart size={20} />} totals={ready.engagements} overview={overview} t={t} locale={locale} />
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
          {ready.truncated && <p className={styles.note}>{fill(t.truncatedNote, { n: ready.channels })}</p>}
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
            <ul className={styles.list}>{upcoming.items.map(item => <li className={styles.item} key={item.id} data-module="publishing">
              <PostThumb thumb={(item as typeof item & { thumbnail?: PostThumbnail | null }).thumbnail ?? null} size="md" />
              <div className={styles.itemBody}>
                <strong>{item.text || '—'}</strong>
                <span className={styles.meta}><time dateTime={item.scheduledAt}>{Number.isNaN(new Date(item.scheduledAt).getTime()) ? item.scheduledAt : timeFormat.format(new Date(item.scheduledAt))}</time><Badge tone="module" module="publishing">{t[MODE_COPY[item.mode]]}</Badge></span>
                <span className={styles.meta}>{item.channels.join(', ')}</span>
              </div>
            </li>)}</ul>
            {upcoming.total > upcoming.items.length && <p className={styles.note}>{fill(t.upcomingMore, { n: upcoming.total })}</p>}
            <a className={styles.link} href="/publishing/queue">{t.viewQueue}</a>
          </>}
        </Body>
      </Card>}

      {overview.inbox && (overview.inbox.state === 'ready'
        ? <Tile module="inbox" span="span4" href={HREF.inbox} linkLabel={t.inboxAction}>
          <MetricCard module="inbox" icon={<IconInbox size={20} />} label={t.inbox} value={number.format(overview.inbox.data.open)} hint={overview.inbox.data.open > 0 ? t.inboxOpen : t.inboxZero} />
        </Tile>
        : overview.inbox.state === 'unavailable' ? <Card module="inbox" icon={<IconInbox size={20} />} title={t.inbox} t={t} span="span4" id="home-inbox"><Unavailable t={t} /></Card> : null)}

      {overview.ads && (readyAds
        ? readyAds.spend.map((group, _index, all) => <Tile key={group.currency ?? 'none'} module="ads" span="span4" href={HREF.ads} linkLabel={fill(t.openModule, { name: t.moduleNames.ads })}>
          <MetricCard module="ads" icon={<IconSpeakerphone size={20} />} label={t.adSpend}
            value={new Intl.NumberFormat(locale, group.currency ? { style: 'currency', currency: group.currency, currencyDisplay: 'code' } : undefined).format(group.total)}
            hint={fill(t.adSpendNote, { n: days, from: dayFormat.format(new Date(readyAds.start)),
              to: dayFormat.format(new Date(readyAds.end)), recorded: group.recordedDays, latest: dayFormat.format(new Date(group.lastDay)) })}
            sparkline={all.length === 1 && group.recordedDays === days && group.daily.length > 1 ? group.daily.map(day => day.v) : undefined} sparklineLabel={fill(t.adSpendTrend, { n: days })} />
        </Tile>)
        : <Card module="ads" icon={<IconSpeakerphone size={20} />} title={t.adSpend} t={t} span="span4" id="home-ads">
          <Body section={overview.ads} t={t} empty={<Empty title={t.adsEmptyTitle} body={t.adsEmptyBody} action={t.adsEmptyAction} href={HREF.ads} />}>{() => null}</Body>
        </Card>)}
    </div>
  </div></PageFrame>;
}
