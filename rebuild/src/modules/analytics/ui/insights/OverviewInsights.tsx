import { IconClockHour4, IconThumbUp } from '@tabler/icons-react';
import { BarChart, HeatmapChart } from '@/components/charts';
import { EmptyState } from '@/components/EmptyState';
import { loadInsights, type InsightChannel } from './load';

const copy = {
  en: {
    timesTitle: 'Best times to post', timesNote: (posts: number, zone: string) => `Relative engagement by weekday and hour (${zone}), from ${posts} measured posts. Each channel is compared with its own typical post.`,
    timesLabel: 'Best times to post by weekday and hour', timesValue: 'Engagement vs typical post',
    timesEmpty: 'Not enough history yet', timesEmptyHint: 'Best times appear once enough published posts have stored engagement.',
    mixTitle: 'Interactions by channel', mixNote: 'Stored interactions on posts published in the selected dates. A blank bar means unknown, not zero.', mixLabel: 'Interactions per channel, stacked by type',
    mixEmpty: 'No interaction data', mixEmptyHint: 'Interaction counts per channel are not stored for this selection.',
  },
  fr: {
    timesTitle: 'Meilleurs moments pour publier', timesNote: (posts: number, zone: string) => `Engagement relatif par jour et par heure (${zone}), d’après ${posts} publications mesurées. Chaque canal est comparé à sa publication habituelle.`,
    timesLabel: 'Meilleurs moments pour publier par jour et par heure', timesValue: 'Engagement par rapport à une publication habituelle',
    timesEmpty: 'Historique insuffisant', timesEmptyHint: 'Les meilleurs moments apparaissent quand assez de publications ont un engagement enregistré.',
    mixTitle: 'Interactions par canal', mixNote: 'Interactions enregistrées sur les publications des dates choisies. Une barre vide signifie inconnu, pas zéro.', mixLabel: 'Interactions par canal, empilées par type',
    mixEmpty: 'Aucune donnée d’interaction', mixEmptyHint: 'Les interactions par canal ne sont pas enregistrées pour cette sélection.',
  },
} as const;

export async function OverviewInsights({ workspaceId, channels, window, locale }: {
  workspaceId: string; channels: readonly InsightChannel[]; window: { from: Date; to: Date }; locale: 'en' | 'fr';
}) {
  const t = copy[locale];
  const { bestTimes, interactions } = await loadInsights(workspaceId, channels, window);
  return <div className="analytics-insights">
    <section className="panel" aria-labelledby="insights-times">
      <div className="analytics-panel-title"><div><h2 id="insights-times">{t.timesTitle}</h2>{bestTimes && <p className="small-note">{t.timesNote(bestTimes.measuredPosts, bestTimes.timeZone)}</p>}</div></div>
      {bestTimes
        ? <HeatmapChart label={t.timesLabel} valueLabel={t.timesValue} locale={locale} format={{ style: 'number', maximumFractionDigits: 2 }} cells={bestTimes.cells.map(cell => ({ day: cell.day, hour: cell.hour, value: cell.value }))} />
        : <EmptyState icon={<IconClockHour4 />} title={t.timesEmpty}>{t.timesEmptyHint}</EmptyState>}
    </section>
    <section className="panel" aria-labelledby="insights-mix">
      <div className="analytics-panel-title"><div><h2 id="insights-mix">{t.mixTitle}</h2>{interactions && <p className="small-note">{t.mixNote}</p>}</div></div>
      {interactions
        ? <BarChart label={t.mixLabel} locale={locale} orientation="horizontal" stacked categories={interactions.categories} series={interactions.series} />
        : <EmptyState icon={<IconThumbUp />} title={t.mixEmpty}>{t.mixEmptyHint}</EmptyState>}
    </section>
  </div>;
}
