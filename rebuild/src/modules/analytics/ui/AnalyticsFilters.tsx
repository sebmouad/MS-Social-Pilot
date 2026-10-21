'use client';
import { overviewCopyDefaults, overviewText, type OverviewCopy } from '../overview-copy';
import { useId, useState, type ReactNode } from 'react';
import { FilterPanel, FilterChips } from '@/components/FilterPanel';
import { Select } from '@/components/Select';

export function AnalyticsFilters({ children, query, path, title, locale = 'en', copy = overviewCopyDefaults[locale] }: {
  copy?: OverviewCopy; children: ReactNode; query: string; path: string; title: string; locale?: 'en' | 'fr';
}) {
  const t = overviewText(copy);
  const params = new URLSearchParams(query);
  const labels: Record<string, string> = { start: t('From'), end: t('To'), search: t('Search'), metric: t('Metric'), source: t('Source'), kind: t('Type'), compare: t('Compare') };
  const filters = [...params].filter(([key, value]) => labels[key] && value && value !== 'none' && value !== 'all')
    .map(([key, value]) => ({ key, label: labels[key]!, value }));
  return <FilterPanel title={title} activeCount={filters.length} resetLabel={t('Reset filters')}
    onReset={() => { window.location.assign(path); }} summary={<FilterChips filters={filters} label={t('Active filters')} removeLabel={t('Remove filter')} onRemove={key => {
      params.delete(key); params.delete('page'); params.delete('pointPage'); params.delete('rowPage');
      window.location.assign(`${path}?${params}`);
    }} />}>{children}</FilterPanel>;
}

export function MetricPicker({ options, initial, label, locale = 'en', copy = overviewCopyDefaults[locale] }: { locale?: 'en' | 'fr'; copy?: OverviewCopy; options: Array<{ key: string; label: string; sourceLabel: string }>; initial: string; label: string }) {
  const t = overviewText(copy);
  const [value, setValue] = useState(initial);
  const id = useId();
  return <div className="ui-field"><label htmlFor={id}>{label}</label><Select id={id} aria-label={label} name="metric" value={value} onChange={setValue} searchable searchLabel={t("Search")} noMatchLabel={t("No match")} options={[
    { value: '', label }, ...options.map(option => ({ value: option.key, label: option.label, description: option.sourceLabel })),
  ]} /></div>;
}

/** Render service-authorized channels without interpreting their platform. */
export function AnalyticsChannelChoices({ channels, selectedIds }: { channels: Array<{ id: string; name: string }>; selectedIds: readonly string[] }) {
  const selected = new Set(selectedIds);
  return channels.map(channel => <label key={channel.id}>
    <input type="checkbox" name="channel" value={channel.id} defaultChecked={selected.has(channel.id)} />
    <span>{channel.name}</span>
  </label>);
}
