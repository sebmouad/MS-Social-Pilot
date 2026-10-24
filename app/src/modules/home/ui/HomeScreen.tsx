import type { ReactNode } from 'react';
import { IconAlertTriangle, IconArrowUpRight, IconCalendarEvent, IconClockHour4, IconEye, IconHeart, IconInbox, IconLink, IconPlugConnected, IconSpeakerphone, IconUsers } from '@tabler/icons-react';
import { InfoTip } from '@/components/InfoTip';
import { ListRow } from '@/components/ListRow';
import { HomeRetry } from './HomeRetry';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, type MetricDelta } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { PostThumb } from '@/components/PostThumb';
import type { PostThumbnail } from '@/components/post-thumbnail';
import { HeatmapChart } from '@/components/charts';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { pageChannelScope } from '@/modules/shell/server/scope';
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
const HREF: Record<Module, string> = { analytics: '/insights', publishing: '/content', inbox: '/inbox', ads: '/ads' };

/** One card: icon chip tinted by its module color, a title and a link to the module. */
function Card({ module, icon, title, t, span, children, id, count }: { module: Module; icon: ReactNode; title: string; t: Copy; span: 'span4' | 'span6' | 'span8' | 'span12'; children: ReactNode; id: string; count?: ReactNode }) {
  return <section className={`${styles.card} ${styles[span]}`} data-module={module} aria-labelledby={id}>
    <div className={styles.cardHead}>
      <span className={styles.chip} aria-hidden="true">{icon}</span>
      <h2 id={id}>{title}{count}</h2>
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
  return <EmptyState tone="error" title={t.unavailableTitle} action={<HomeRetry label={t.retry} />}>{t.unavailableBody}</EmptyState>;
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
function Tile({ children, module }: { children: ReactNode; module: Module }) {
  return <div className={styles.tile} data-module={module}>{children}</div>;
}

function TileLink({ href, label }: { href: string; label: string }) {
  return <a className={styles.link} href={href}>{label} <IconArrowUpRight size={14} aria-hidden="true" /></a>;
}

function Kpi({ title, icon, totals, overview, t, locale }: { title: string; icon: ReactNode; totals: NonNullable<Extract<HomeOverview['performance'], { state: 'ready' }>['data']>['views']; overview: HomeOverview; t: Copy; locale: string }) {
  const number = new Intl.NumberFormat(locale);
  const delta = deltaOf(totals.change, t, overview.lookbackDays, locale);
  const partial = totals.comparable > 0 && totals.comparable < totals.covered;
  return <Tile module="analytics">
    <MetricCard module="analytics" icon={icon} label={title} footer={<TileLink href={HREF.analytics} label={fill(t.openModule, { name: t.moduleNames.analytics })} />} value={totals.current === null ? null : number.format(totals.current)} unavailable={totals.current === null ? t.unknownFigure : undefined} delta={delta}
      info={<InfoTip name={title} warning={totals.covered < overview.channelCount || partial || Boolean(overview.performance?.state === 'ready' && overview.performance.data.truncated)}><p>{fill(t.period, { n: overview.lookbackDays })}</p><p>{fill(t.channelsNote, { covered: totals.covered, channels: overview.channelCount })}</p><p>{!delta ? t.noComparison : partial ? fill(t.comparableNote, { comparable: totals.comparable, covered: totals.covered }) : undefined}</p></InfoTip>} />
  </Tile>;
}

const MODE_COPY: Record<ScheduleMode, 'modeApp' | 'modePlatform' | 'modeMixed'> = { app: 'modeApp', platform: 'modePlatform', mixed: 'modeMixed' };

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ feature: 'home/overview' });
  const locale = await authLocale();
  const t = await loadHomeCopy(locale);
  const showConnections = canUseFeature(viewer.entitlements, 'settings/connections') && canAccessFeature(viewer.permissions, 'settings/connections', 'read');
  const scope = viewer.permissions.pageScope;
  const visibleTargets = await getTargets(viewer.workspaceId, scope.all ? undefined : scope.ids, entitledPlatformIds(viewer.entitlements));
  if (visibleTargets.length === 0) return <PageFrame module="home"><div className={styles.root}><PageHeader module="home" title={viewer.user.name ? `${t.greeting}, ${viewer.user.name}` : t.greeting} /><EmptyState icon={<IconPlugConnected size={22} />} title={t.startTitle} action={showConnections ? <a className={CTA} href="/settings/channels"><span>{t.startAction}</span></a> : undefined}>{t.startBody}</EmptyState></div></PageFrame>;
  const params = (await searchParams) ?? {};
  // The sidebar scope narrows the figures through the service, together with REST and MCP; never in the UI.
  const channelScope = await pageChannelScope(viewer, params).catch(() => null);
  const overview = await readHomeOverview({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, new Date(), channelScope?.ids.length ? { channelIds: channelScope.ids } : {});
  const number = new Intl.NumberFormat(locale);
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const timeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: overview.timeZone });
  const days = overview.lookbackDays;
  const periodEnd = new Date(overview.generatedAt);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - days + 1);
  const performance = overview.performance;
  const ready = performance?.state === 'ready' ? performance.data : null;
  const readyAds = overview.ads?.state === 'ready' ? overview.ads.data : null;
  const attention = overview.attention?.state === 'ready' ? overview.attention.data : null;
  const attentionRows: Array<{ key: string; icon: ReactNode; title: string; href: string }> = attention ? [
    ...(attention.failedPosts ? [{ key: 'failed', icon: <IconAlertTriangle size={18} aria-hidden="true" />, title: fill(t.attentionFailed, { n: number.format(attention.failedPosts) }), href: '/content?status=failed' }] : []),
    ...(attention.partiallyFailedPosts ? [{ key: 'partial', icon: <IconAlertTriangle size={18} aria-hidden="true" />, title: fill(t.attentionPartial, { n: number.format(attention.partiallyFailedPosts) }), href: '/content?status=partially_failed' }] : []),
    ...(attention.pendingApprovals ? [{ key: 'approvals', icon: <IconClockHour4 size={18} aria-hidden="true" />, title: fill(t.attentionApprovals, { n: number.format(attention.pendingApprovals) }), href: '/content/approvals' }] : []),
    ...(attention.reconnect?.length ? [{ key: 'reconnect', icon: <IconPlugConnected size={18} aria-hidden="true" />,
      title: attention.reconnect.length === 1 ? fill(t.attentionReconnect, { name: attention.reconnect[0]!.name }) : fill(t.attentionReconnectMany, { n: number.format(attention.reconnect.length) }),
      href: '/settings/channels' }] : []),
    ...(attention.waitingConversations ? [{ key: 'inbox', icon: <IconInbox size={18} aria-hidden="true" />, title: fill(t.attentionConversations, { n: number.format(attention.waitingConversations) }), href: '/inbox' }] : []),
  ] : [];

  return <PageFrame module="home"><div className={styles.root}>
    <PageHeader module="home" title={viewer.user.name ? `${t.greeting}, ${viewer.user.name}` : t.greeting}
      actions={<><Badge tone="neutral" icon={<IconCalendarEvent size={14} />}>{dayFormat.format(periodStart)} – {dayFormat.format(periodEnd)}</Badge><InfoTip name={t.metrics}><p>{fill(t.period, { n: days })}</p></InfoTip></>} />
    {attentionRows.length > 0 && <section className={styles.attention} aria-label={t.attention}>
      <h2>{t.attention}{attention?.partial ? <InfoTip name={t.attention} warning><p>{t.attentionPartialNote}</p></InfoTip> : null}</h2>
      {attentionRows.map(row => <ListRow key={row.key} leading={row.icon} title={row.title} href={row.href} className={row.key === 'failed' || row.key === 'reconnect' ? styles.danger : row.key === 'partial' ? styles.warning : ''} trailing={<span className={styles.review} title={t.attentionReview}><IconArrowUpRight size={16} aria-hidden="true" /></span>} />)}
    </section>}
    <div className={styles.kpis}>
      {overview.audience && (overview.audience.state === 'ready'
        ? <Tile module="analytics">
          <MetricCard module="analytics" icon={<IconUsers size={20} />} label={t.audience} footer={<TileLink href={HREF.analytics} label={fill(t.openModule, { name: t.moduleNames.analytics })} />} value={number.format(overview.audience.data.total)}
            delta={overview.audience.data.delta ? { label: `${overview.audience.data.delta.value > 0 ? '+' : overview.audience.data.delta.value < 0 ? '−' : ''}${number.format(Math.abs(overview.audience.data.delta.value))}`, direction: overview.audience.data.delta.value > 0 ? 'up' : overview.audience.data.delta.value < 0 ? 'down' : 'flat', comparedTo: fill(t.audienceDeltaSince, { date: dayFormat.format(new Date(`${overview.audience.data.delta.since}T00:00:00Z`)) }) } : undefined}
            info={<InfoTip name={t.audience} warning={overview.audience.data.covered < overview.audience.data.selected}><p>{fill(t.audienceOf, { covered: overview.audience.data.covered, selected: overview.audience.data.selected })}{overview.audience.data.asOf ? ` · ${fill(t.audienceAsOf, { date: dayFormat.format(new Date(overview.audience.data.asOf)) })}` : ''}</p><p>{t.audienceNote}</p></InfoTip>}
            sparkline={overview.audience.data.trend.length > 1 ? overview.audience.data.trend.map(point => point.v) : undefined} sparklineLabel={fill(t.audienceTrend, { n: days })} />
        </Tile>
        : <Card module="analytics" icon={<IconUsers size={20} />} title={t.audience} t={t} span="span4" id="home-audience">
          <Body section={overview.audience} t={t} empty={<Empty title={t.audienceEmptyTitle} body={t.audienceEmptyBody} action={t.audienceEmptyAction} href={HREF.analytics} />}>{() => null}</Body>
        </Card>)}
      {ready && <>
        <Kpi title={t.views} icon={<IconEye size={20} />} totals={ready.views} overview={overview} t={t} locale={locale} />
        <Kpi title={t.engagements} icon={<IconHeart size={20} />} totals={ready.engagements} overview={overview} t={t} locale={locale} />
        {ready.linkClicks && <Kpi title={t.linkClicks} icon={<IconLink size={20} />} totals={ready.linkClicks} overview={overview} t={t} locale={locale} />}
      </>}


      {overview.ads && (readyAds
        ? readyAds.spend.map((group, _index, all) => <Tile key={group.currency ?? 'none'} module="ads">
          <MetricCard module="ads" icon={<IconSpeakerphone size={20} />} label={t.adSpend} footer={<TileLink href={HREF.ads} label={fill(t.openModule, { name: t.moduleNames.ads })} />}
            value={new Intl.NumberFormat(locale, group.currency ? { style: 'currency', currency: group.currency, currencyDisplay: 'code' } : undefined).format(group.total)}
            info={<InfoTip name={t.adSpend} warning={group.recordedDays < days}>{fill(t.adSpendNote, { n: days, from: dayFormat.format(new Date(readyAds.start)),
              to: dayFormat.format(new Date(readyAds.end)), recorded: group.recordedDays, latest: dayFormat.format(new Date(group.lastDay)) })}</InfoTip>}
            sparkline={all.length === 1 && group.recordedDays === days && group.daily.length > 1 ? group.daily.map(day => day.v) : undefined} sparklineLabel={fill(t.adSpendTrend, { n: days })} />
        </Tile>)
        : <Card module="ads" icon={<IconSpeakerphone size={20} />} title={t.adSpend} t={t} span="span4" id="home-ads">
          <Body section={overview.ads} t={t} empty={<Empty title={t.adsEmptyTitle} body={t.adsEmptyBody} action={t.adsEmptyAction} href={HREF.ads} />}>{() => null}</Body>
        </Card>)}
    </div>
    <div className={styles.grid}>
      <div className={styles.main}>
      {performance && !ready && <Card module="analytics" icon={<IconEye size={20} />} title={`${t.views} · ${t.engagements}`} t={t} span="span8" id="home-performance">
        <Body section={performance} t={t} empty={<Empty title={t.perfEmptyTitle} body={t.perfEmptyBody} action={t.perfEmptyAction} href={HREF.analytics} />}>{() => null}</Body>
      </Card>}
      {overview.upcoming && <Card module="publishing" icon={<IconCalendarEvent size={20} />} title={t.upcoming} t={t} span="span8" id="home-upcoming">
        <Body section={overview.upcoming} t={t} empty={<Empty title={t.upcomingEmptyTitle} body={t.upcomingEmptyBody} action={t.upcomingEmptyAction} href="/create" />}>
          {upcoming => <>
            <div className={styles.list}>{upcoming.items.map(item => <ListRow key={item.id}
              href={`/content?post=${encodeURIComponent(item.id)}`}
              leading={<PostThumb thumb={(item as typeof item & { thumbnail?: PostThumbnail | null }).thumbnail ?? null} size="md" />}
              title={item.text || '—'}
              meta={<><time dateTime={item.scheduledAt}>{Number.isNaN(new Date(item.scheduledAt).getTime()) ? item.scheduledAt : timeFormat.format(new Date(item.scheduledAt))}</time> · {item.channels.join(', ')}</>}
              trailing={<InfoTip name={t.upcoming}><p>{t[MODE_COPY[item.mode]]}</p><p>{overview.timeZone}</p></InfoTip>} />)}</div>
            {upcoming.total > upcoming.items.length && <p className={styles.note}>{fill(t.upcomingMore, { n: upcoming.total })}</p>}
            <TileLink href="/content/calendar" label={t.openCalendar} />
          </>}
        </Body>
      </Card>}

      </div>
      <div className={styles.rail}>
      {overview.inbox && (overview.inbox.state === 'ready'
        ? <Card module="inbox" icon={<IconInbox size={20} />} title={t.inbox} t={t} span="span4" id="home-inbox" count={overview.inbox.data.open > 0 ? <Badge tone="brand">{number.format(overview.inbox.data.open)}</Badge> : undefined}>
          {overview.inbox.data.recent.length > 0
            ? <div className={styles.list}>{overview.inbox.data.recent.map(row => <ListRow key={row.key}
              href={`/inbox?thread=${encodeURIComponent(row.key)}`} title={row.preview || row.author}
              meta={<><span>{row.author}</span> · <span>{row.channel}</span> · <time dateTime={row.time}>{Number.isNaN(new Date(row.time).getTime()) ? row.time : timeFormat.format(new Date(row.time))}</time>{row.unread > 0 ? <> · <Badge tone="brand">{number.format(row.unread)}</Badge></> : null}</>} />)}</div>
            : <p className={styles.note}>{overview.inbox.data.open > 0 ? `${number.format(overview.inbox.data.open)} ${t.inboxOpen}` : t.inboxZero}</p>}
        </Card>
        : overview.inbox.state === 'unavailable' ? <Card module="inbox" icon={<IconInbox size={20} />} title={t.inbox} t={t} span="span4" id="home-inbox"><Unavailable t={t} /></Card> : null)}

      {overview.bestTimes && <Card module="publishing" icon={<IconClockHour4 size={18} />} title={t.bestTimes} t={t} span="span4" id="home-times">
        <Body section={overview.bestTimes} t={t} empty={<Empty title={t.bestTimesEmptyTitle} body={t.bestTimesEmptyBody} action={t.bestTimesEmptyAction} href="/create" />}>
          {times => <>
            <HeatmapChart label={t.bestTimesLabel} valueLabel={t.bestTimesValue} locale={locale} format={{ style: 'number', maximumFractionDigits: 2 }} cells={times.cells.map(cell => ({ day: cell.day, hour: cell.hour, value: cell.value }))} />
            <InfoTip name={t.bestTimes}><p>{t.bestTimesNote}</p></InfoTip>
          </>}
        </Body>
      </Card>}
      </div>
    </div>
  </div></PageFrame>;
}
