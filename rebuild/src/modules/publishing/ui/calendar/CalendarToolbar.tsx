'use client';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FilterButton } from '@/components';
import { postGroup } from '@/lib/post-groups';
import { usePublishingCopy, usePublishingLocale } from '../kit/CopyProvider';
import { useContent } from '../ContentProvider';
import { SavedViews } from '../SavedViews';
import { UrlFilterChips, type UrlFilterChip } from '../kit/UrlFilterChips';
import styles from './calendar.module.css';

/**
 * Calendar controls inside the page (design v2 S3): previous / today / next, the range, Month | Week and the
 * page's one Filter button. Filters write the address (the sidebar's channel scope stays), so a view can be shared or saved.
 */
export function CalendarToolbar({ navigation, rangeLabel, view, viewHrefs, statuses, origins, chips, resetHref, counts }: {
  navigation: { previous: string; today: string; next: string; unit: 'week' | 'month' };
  rangeLabel: string;
  view: 'month' | 'week' | 'list';
  viewHrefs: { month: string; week: string; list: string };
  statuses: Array<{ value: string; label: string }>;
  origins: Array<{ kind: string; label: string }>;
  chips: UrlFilterChip[];
  resetHref: string;
  /** Planned vs published posts in the visible range (after the active filters); hidden when unknown. */
  counts?: { planned: number; published: number };
}) {
  const copy = usePublishingCopy();
  const locale = usePublishingLocale();
  const { copy: content } = useContent();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const unit = navigation.unit === 'week' ? copy.calendarUnitWeek : copy.calendarUnitMonth;
  const go = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value); else next.delete(name);
    const query = next.toString();
    router.push(`${pathname}${query ? `?${query}` : ''}`);
  };
  return <div className={styles.toolbar} role="toolbar" aria-label={content.calendarToolbar}>
    <nav className={styles.toolbarNav} aria-label={copy.calendarNavigation.replace('{unit}', unit)}>
      <a className="ui-button ui-button--secondary ui-button--md" href={navigation.previous} aria-label={`${copy.previous} ${unit}`}><IconChevronLeft size={16} aria-hidden="true" /></a>
      <a className="ui-button ui-button--secondary ui-button--md" href={navigation.today}>{copy.today}</a>
      <a className="ui-button ui-button--secondary ui-button--md" href={navigation.next} aria-label={`${copy.next} ${unit}`}><IconChevronRight size={16} aria-hidden="true" /></a>
    </nav>
    <h2 className={styles.toolbarRange} aria-live="polite">{rangeLabel}</h2>
    {counts ? <p className={styles.toolbarCounts}>{copy.plannedPublished(counts.planned.toLocaleString(locale), counts.published.toLocaleString(locale))}</p> : null}
    <div className={styles.toolbarEnd}>
      <div className={styles.viewSwitch} role="group" aria-label={copy.view}>
        <a href={viewHrefs.month} aria-current={view === 'month' ? 'true' : undefined}>{copy.month}</a>
        <a href={viewHrefs.week} aria-current={view === 'week' ? 'true' : undefined}>{copy.week}</a>
        <a href={viewHrefs.list} aria-current={view === 'list' ? 'true' : undefined}>{content.calendarViewList}</a>
      </div>
      <FilterButton activeCount={chips.length} onClear={() => router.push(resetHref)}>
        <div className={styles.filterBody}>
          <label>{content.contentFilterStatus}
            <select value={params.get('status') ?? ''} onChange={event => go('status', event.currentTarget.value)}>
              <option value="">{content.contentFilterAnyStatus}</option>
              <optgroup label={copy.groupPlanned}>
                {statuses.filter(item => postGroup(item.value) === 'planned').map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </optgroup>
              <optgroup label={copy.groupOutcome}>
                {statuses.filter(item => postGroup(item.value) === 'outcome').map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </optgroup>
            </select>
          </label>
          {origins.length ? <label>{content.contentFilterOrigin}
            <select value={params.get('origin') ?? ''} onChange={event => go('origin', event.currentTarget.value)}>
              <option value="">{content.contentFilterAnyOrigin}</option>
              {origins.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}
            </select>
          </label> : null}
          <SavedViews screen="calendar" />
        </div>
      </FilterButton>
    </div>
    <UrlFilterChips chips={chips} resetHref={resetHref} labels={{ active: copy.activeFilters, remove: copy.removeFilter, reset: content.contentFilterClear }} />
  </div>;
}
