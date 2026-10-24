import { overviewText } from '../../overview-copy';
import { loadOverviewCopy } from '../../server/overview-copy';
import { IconClockHour4, IconThumbUp } from '@tabler/icons-react';
import { BarChart, HeatmapChart } from '@/components/charts';
import { EmptyState } from '@/components/EmptyState';
import { loadInsights, type InsightChannel } from './load';

export async function OverviewInsights({ workspaceId, channels, window, locale }: {
  workspaceId: string; channels: readonly InsightChannel[]; window: { from: Date; to: Date }; locale: 'en' | 'fr';
}) {
  const t = overviewText(await loadOverviewCopy(locale));
  const { bestTimes, interactions } = await loadInsights(workspaceId, channels, window);
  return <div className="analytics-insights">
    <section className="panel" aria-labelledby="insights-times">
      <div className="analytics-panel-title"><div><h2 id="insights-times">{t("Best times to post")}</h2>{bestTimes && <p className="small-note">{t("Relative engagement by weekday and hour ({zone}), from {posts} measured posts. Each channel is compared with its own typical post.", { posts: bestTimes.measuredPosts, zone: bestTimes.timeZone })}</p>}</div></div>
      {bestTimes
        ? <HeatmapChart label={t("Best times to post by weekday and hour")} valueLabel={t("Engagement vs typical post")} locale={locale} format={{ style: 'number', maximumFractionDigits: 2 }} cells={bestTimes.cells.map(cell => ({ day: cell.day, hour: cell.hour, value: cell.value }))} />
        : <EmptyState icon={<IconClockHour4 />} title={t("Not enough history yet")}>{t("Best times appear once enough published posts have stored engagement.")}</EmptyState>}
    </section>
    <section className="panel" aria-labelledby="insights-mix">
      <div className="analytics-panel-title"><div><h2 id="insights-mix">{t("Interactions by channel")}</h2>{interactions && <p className="small-note">{t("Stored interactions on posts published in the selected dates. A blank bar means unknown, not zero.")}</p>}</div></div>
      {interactions
        ? <BarChart label={t("Interactions per channel, stacked by type")} locale={locale} orientation="horizontal" stacked categories={interactions.categories} series={interactions.series} />
        : <EmptyState icon={<IconThumbUp />} title={t("No interaction data")}>{t("Interaction counts per channel are not stored for this selection.")}</EmptyState>}
    </section>
  </div>;
}
