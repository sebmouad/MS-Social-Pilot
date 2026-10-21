"use client";
import { uiCopy, type CustomerCopy, type UiLocale } from './copy';
import { SidebarDock } from '@/components/SidebarDock';
import { useState } from 'react';
import { Button, Select, FilterPanel, FilterChips, TextInput } from '@/components';
import { AGENCY_SORTS } from '@/modules/agency/agency';
import styles from './agency.module.css';

export const AGENCY_SORT_LABELS: Record<(typeof AGENCY_SORTS)[number], string> = {
  name: 'Workspace name', channels: 'Channels', attention: 'Needs attention', scheduled: 'Scheduled posts', failed: 'Failed posts',
  openTasks: 'Open tasks', overdueTasks: 'Overdue tasks', members: 'Team members',
};

/**
 * Overview filters live in the shell sidebar (or phone drawer) and submit as plain GET navigation. `searchLimit`
 * is the Root-managed search length the service enforces. Name search runs on the server before the workspace cap.
 */
export function AgencyFilters({ values, searchLimit, locale = 'en', copy }: { values: { q: string; sort: string; order: string; attention: boolean }; searchLimit: number; copy?: CustomerCopy; locale?: UiLocale }) {
  const t = uiCopy(locale, copy);
  const [draft, setDraft] = useState(values);
  const filters = [...(values.q ? [{ key: 'q', label: t("Search"), value: values.q }] : []), ...(values.attention ? [{ key: 'attention', label: t("Status"), value: t("Needs attention") }] : [])];
  const remove = (key: string) => { const query = new URLSearchParams(window.location.search); query.delete(key); window.location.assign(`/agency${query.size ? `?${query}` : ''}`); };
  return <><FilterChips removeLabel={t('Remove filter')} label={t('Active filters')} filters={filters} onRemove={remove} /><SidebarDock><FilterPanel resetLabel={t('Reset filters')} title={t("Workspace filters")} activeCount={filters.length} onReset={() => window.location.assign('/agency')}>
    <FilterChips removeLabel={t('Remove filter')} label={t('Active filters')} filters={filters} onRemove={remove} />
    <form noValidate action="/agency" method="get" className={styles.filters} aria-label={t("Workspace filters")}>
      <label>{t("Search")}<TextInput type="search" name="q" maxLength={searchLimit} value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} placeholder={t("Workspace name")} trailing={draft.q ? <button type="button" className="ui-icon-button" aria-label={t("Clear search")} onClick={() => setDraft({ ...draft, q: '' })}>×</button> : undefined} /></label>
      <label>{t("Sort by")}<Select aria-label={t("Sort by")} name="sort" value={draft.sort} onChange={sort => setDraft({ ...draft, sort })} options={AGENCY_SORTS.map(sort => ({ value: sort, label: t(AGENCY_SORT_LABELS[sort]) }))} /></label>
      <label>{t("Order")}<Select aria-label={t("Order")} name="order" value={draft.order} onChange={order => setDraft({ ...draft, order })} options={[{ value: 'desc', label: t("Highest first") }, { value: 'asc', label: t("Lowest first") }]} /></label>
      <label className={styles.check}><input type="checkbox" name="attention" value="true" checked={draft.attention} onChange={event => setDraft({ ...draft, attention: event.target.checked })} />{t("Needs attention only")}</label>
      <Button type="submit" variant="primary">{t("Apply filters")}</Button>
      <a href="/agency">{t("Reset filters")}</a>
    </form>
  </FilterPanel></SidebarDock></>;
}

export function ClientFilters({ q, searchLimit, locale = 'en', copy }: { q: string; searchLimit: number; copy?: CustomerCopy; locale?: UiLocale }) {
  const t = uiCopy(locale, copy);
  const [search, setSearch] = useState(q);
  const filters = q ? [{ key: 'q', label: t("Search"), value: q }] : [];
  return <><FilterChips removeLabel={t('Remove filter')} label={t('Active filters')} filters={filters} onRemove={() => window.location.assign('/agency/clients')} /><SidebarDock><FilterPanel resetLabel={t('Reset filters')} title={t("Client filters")} activeCount={filters.length} onReset={() => window.location.assign('/agency/clients')}>
    <form noValidate action="/agency/clients" method="get" className={styles.filters} aria-label={t("Client filters")}>
      <label>{t("Search")}<TextInput type="search" name="q" maxLength={searchLimit} value={search} onChange={event => setSearch(event.target.value)} placeholder={t("Workspace name")} trailing={search ? <button type="button" className="ui-icon-button" aria-label={t("Clear search")} onClick={() => setSearch('')}>×</button> : undefined} /></label>
      <Button type="submit" variant="primary">{t("Apply filters")}</Button>
      <a href="/agency/clients">{t("Reset filters")}</a>
    </form>
  </FilterPanel></SidebarDock></>;
}
