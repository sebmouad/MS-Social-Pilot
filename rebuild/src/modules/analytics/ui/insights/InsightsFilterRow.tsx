'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { DateRangePicker, FilterButton } from '@/components';
import './insights.css';

export type InsightsPresetOption = { id: string; label: string; start: string; end: string };
export type InsightsChip = { key: string; label: string; value: string };

/**
 * The Insights filter row (design v2 S9): the period picker with its compare switch, then the page's one Filter
 * button for everything else. Both write the address, so a view can be shared; the sidebar's `channel` scope and
 * every other parameter are kept, and paging restarts.
 */
export function InsightsFilterRow({ presets, period, compare, showCompare = true, chips = [], activeCount = 0, labels, children, hidePeriod = false, names = { from: 'start', to: 'end' }, customPeriod }: {
  /** Address parameters of a typed range; Ads uses `since`/`until`. */
  names?: { from: string; to: string };
  /** Preset id written for a typed range when the page needs one (Ads: `custom`); otherwise the preset parameter is removed. */
  customPeriod?: string;
  presets: InsightsPresetOption[];
  period: { preset: string; start: string; end: string };
  compare: boolean;
  showCompare?: boolean;
  chips?: InsightsChip[];
  /** Filters in the Filter button (the period is not counted). */
  activeCount?: number;
  labels: { period: string; compare: string; active: string; remove: string; reset: string; filters: string; customSummary: string };
  /** Filter fields; they read and write the address through `useInsightsParams`. */
  children?: ReactNode;
  hidePeriod?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    for (const paging of ['page', 'pointPage', 'rowPage', 'offset']) next.delete(paging);
    const query = next.toString();
    router.push(`${pathname}${query ? `?${query}` : ''}`);
  };
  const clearAll = () => {
    const next = new URLSearchParams();
    const scope = params.get('channel');
    if (scope) next.set('channel', scope);
    const kind = params.get('kind');
    if (kind) next.set('kind', kind);
    const query = next.toString();
    router.push(`${pathname}${query ? `?${query}` : ''}`);
  };
  const customSummary = `${period.start} – ${period.end}`;
  return <div className="insights-filterrow" role="group" aria-label={labels.filters}>
    {!hidePeriod && <DateRangePicker label={labels.period} presets={presets.map(item => ({ id: item.id, label: item.label }))}
      value={{ preset: period.preset, from: period.start, to: period.end }} customSummary={period.preset === 'custom' ? customSummary : labels.customSummary}
      onChange={value => {
        if (value.preset === 'custom') push({ period: customPeriod ?? null, [names.from]: value.from ?? null, [names.to]: value.to ?? null });
        else push({ period: value.preset, [names.from]: null, [names.to]: null });
      }}
      compare={showCompare ? { checked: compare, onChange: checked => push({ compare: checked ? 'previous' : null }), label: labels.compare } : undefined} />}
    {children && <FilterButton title={labels.filters} activeCount={activeCount} onClear={clearAll} closeOnDone>
      <div className="insights-filterbody">{children}</div>
    </FilterButton>}
    {chips.length > 0 && <ul className="insights-chips" aria-label={labels.active}>
      {chips.map(chip => <li key={chip.key} className="insights-chip"><span>{chip.label}: {chip.value}</span>
        <button type="button" aria-label={`${labels.remove}: ${chip.label}`} onClick={() => push({ [chip.key]: null })}>×</button></li>)}
      <li><button type="button" className="insights-chip__reset" onClick={clearAll}>{labels.reset}</button></li>
    </ul>}
  </div>;
}

/** Writes one address parameter from a Filter-button field and keeps the rest (including the channel scope). */
export function useInsightsParam(name: string): [string, (value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return [params.get(name) ?? '', value => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value); else next.delete(name);
    for (const paging of ['page', 'pointPage', 'rowPage', 'offset']) next.delete(paging);
    const query = next.toString();
    router.push(`${pathname}${query ? `?${query}` : ''}`);
  }];
}
