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

  // Relabelled here, on the server, and handed down as plain data. `BarList` is
  // a client component, and a function cannot cross that boundary: passing
  // `formatKey` through made the whole Interactions view a 500 the moment it
  // had anything to show. Keys that relabel to the same name are summed.
  const labelled: Record<string, number> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const label = formatKey ? formatKey(key) : key;
    labelled[label] = (labelled[label] ?? 0) + value;
  }

  const rows = Object.entries(labelled)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <ChartFrame
      title={title}
      description={description}
      table={rows.length > 0 ? { head: [t('category'), t('value')], rows } : undefined}
    >
      <BarList data={labelled} limit={limit} colorIndex={colorIndex} />
    </ChartFrame>
  );
}
