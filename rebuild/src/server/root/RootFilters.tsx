'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Select, type SelectOption } from '@/components/Select';
import { useRouter } from 'next/navigation';
import { FilterPanel, FilterChips, type ActiveFilter } from '@/components/FilterPanel';
import { useRootInterface } from './RootInterface';

/** Applied filters stay in the sidebar; changing scope always resets pagination. */
export function RootFilters({ title, route, filters, children }: { title: string; route: string; filters: ActiveFilter[]; children: ReactNode }) {
  const router = useRouter();
  const copy = useRootInterface();
  function remove(key: string) {
    const query = new URLSearchParams(window.location.pathname === route ? window.location.search : filters.map(item => [item.key, item.value]));
    for (const name of [key, 'page', 'cursor']) query.delete(name);
    router.push(`${route}${query.size ? `?${query}` : ''}`);
  }
  return <div className="root-filter-controls"><FilterPanel title={title} activeCount={filters.length} onReset={() => router.push(route)} resetLabel={copy.reset}>
    <FilterChips filters={filters} onRemove={remove} label={copy.filters} removeLabel={copy.removeFilter} />
    {children}
  </FilterPanel></div>;
}

/** URL-owned filter field: submits a native hidden value and retains unavailable selections. */
export function RootFilterSelect({ name, label, initialValue, options }: { name: string; label: string; initialValue: string; options: readonly SelectOption[] }) {
  const [value, setValue] = useState(initialValue);
  const copy = useRootInterface();
  useEffect(() => setValue(initialValue), [initialValue]);
  const choices = options.some(option => option.value === value) ? [...options] : [{ value, label: `${value} · ${copy.unavailable}`, disabled: true }, ...options];
  return <Select name={name} aria-label={label} value={value} options={choices} onChange={setValue} />;
}
