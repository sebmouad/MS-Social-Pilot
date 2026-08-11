import { getTranslations } from 'next-intl/server';

import { BarList } from '@/components/charts/BarList';
import { ChartFrame } from '@/components/charts/ChartFrame';

/**
 * A labelled bar list for a breakdown map, in a chart frame.
 *
 * The frame carries the table view, which is what lets the lighter categorical
 * hues be used at all: every value is readable without depending on telling
 * colours apart.
 */
export async function BreakdownBars({
  title,
  description,
  data,
  limit = 8,
  colorIndex = 0,
  formatKey,
}: {
  title: string;
  description?: string;
  data: Record<string, number>;
  limit?: number;
  colorIndex?: number;
  formatKey?: (key: string) => string;
}) {
  const t = await getTranslations('analytics');

  const rows = Object.entries(data)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => [formatKey ? formatKey(key) : key, value] as [string, number]);

  return (
    <ChartFrame
      title={title}
      description={description}
      table={rows.length > 0 ? { head: [t('category'), t('value')], rows } : undefined}
    >
      <BarList data={data} limit={limit} colorIndex={colorIndex} formatKey={formatKey} />
    </ChartFrame>
  );
}
