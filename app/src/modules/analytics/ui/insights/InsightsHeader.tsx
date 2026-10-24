import type { ReactNode } from 'react';
import { InfoTip } from '@/components';
import { PageHeader } from '@/components/PageHeader';
import { InsightsFilterRow, type InsightsChip } from './InsightsFilterRow';
import type { InsightsRuntime } from './runtime';
import { presetRange, type ResolvedPeriod } from './period';

/**
 * The header every Insights tab shares (design v2 S9–S12): title with its ⓘ, the page's actions and one filter row
 * (period picker with compare, then the single Filter button). Area tabs come from the shell; the channel list scopes
 * the page from the sidebar, so no channel filter lives here.
 */
export function InsightsHeader({ runtime, title, info, actions, period, filterBody, chips, activeCount, showCompare = true, hidePeriod = false, module = 'analytics', count }: {
  runtime: InsightsRuntime;
  title: string;
  info?: string;
  actions?: ReactNode;
  period: ResolvedPeriod;
  /** Fields of the Filter button; omit when the page has nothing to filter besides the period. */
  filterBody?: ReactNode;
  chips?: InsightsChip[];
  activeCount?: number;
  showCompare?: boolean;
  hidePeriod?: boolean;
  module?: string;
  count?: ReactNode;
}) {
  const { copy, policy, locale } = runtime;
  const now = new Date();
  const presets = policy.rangePresets.map(item => ({ id: item.id, label: item.label[locale], ...presetRange(item, now) }));
  return <PageHeader module={module} title={title} count={count} info={info ? <InfoTip name={title} blocks={[{ text: info }]} /> : undefined} actions={actions}
    filters={<InsightsFilterRow presets={presets} period={period} compare={period.compare !== 'none'} showCompare={showCompare} hidePeriod={hidePeriod} chips={chips} activeCount={activeCount}
      labels={{ period: copy.datePeriod, compare: copy.compareToggle, active: copy.activeFilters, remove: copy.removeFilter, reset: copy.resetFilters, filters: copy.filtersTitle, customSummary: copy.datePeriod }}>{filterBody}</InsightsFilterRow>} />;
}
