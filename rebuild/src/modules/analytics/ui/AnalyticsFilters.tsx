'use client';
import { useId, useState, type ReactNode } from 'react';
import { FilterPanel, FilterChips } from '@/components/FilterPanel';
import { Select } from '@/components/Select';

export function AnalyticsFilters({ children, query, path, title, locale = 'en' }: {
  children: ReactNode; query: string; path: string; title: string; locale?: 'en' | 'fr';
}) {
  const params = new URLSearchParams(query);
  const labels: Record<string, string> = locale === 'fr'
    ? { start: 'Du', end: 'Au', search: 'Recherche', metric: 'Mesure', source: 'Source', kind: 'Type', compare: 'Comparaison' }
    : { start: 'From', end: 'To', search: 'Search', metric: 'Metric', source: 'Source', kind: 'Type', compare: 'Compare' };
  const filters = [...params].filter(([key, value]) => labels[key] && value && value !== 'none' && value !== 'all')
    .map(([key, value]) => ({ key, label: labels[key]!, value }));
  return <FilterPanel title={title} activeCount={filters.length} resetLabel={locale === 'fr' ? 'Réinitialiser les filtres' : 'Reset filters'}
    onReset={() => { window.location.assign(path); }} summary={<FilterChips filters={filters} label={locale === 'fr' ? 'Filtres actifs' : 'Active filters'} removeLabel={locale === 'fr' ? 'Retirer le filtre' : 'Remove filter'} onRemove={key => {
      params.delete(key); params.delete('page'); params.delete('pointPage'); params.delete('rowPage');
      window.location.assign(`${path}?${params}`);
    }} />}>{children}</FilterPanel>;
}

export function MetricPicker({ options, initial, label }: { options: Array<{ key: string; label: string; sourceLabel: string }>; initial: string; label: string }) {
  const [value, setValue] = useState(initial);
  const id = useId();
  return <div className="ui-field"><label htmlFor={id}>{label}</label><Select id={id} aria-label={label} name="metric" value={value} onChange={setValue} searchable options={[
    { value: '', label }, ...options.map(option => ({ value: option.key, label: option.label, description: option.sourceLabel })),
  ]} /></div>;
}
