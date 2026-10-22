'use client';
import { useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IconDownload } from '@tabler/icons-react';
import { Button, Drawer, FilterButton } from '@/components';
import { PostExport } from './PostExport';
import { SavedViews } from '../SavedViews';
import { useContent } from '../ContentProvider';
import { UrlFilterChips, type UrlFilterChip } from '../kit/UrlFilterChips';
import { postGroup } from '@/lib/post-groups';
import { usePublishingCopy } from '../kit/CopyProvider';
import type { KitLocale } from '../kit/copy';
import styles from './posts-table.module.css';

/**
 * The one filter row of Content › Posts (design v2 S2): the page's Filter button (status, who created it, saved views),
 * the active-filter chips, a search box and Export. Every control writes the address, so a filtered list is shareable.
 */
export function PostsHeaderTools({ statuses, origins, chips, resetHref, searchMaxCharacters, exportMaxPosts, exportMaxBytes, locale = 'en', canExport }: {
  statuses: Array<{ value: string; label: string }>;
  origins: Array<{ kind: string; label: string }>;
  chips: UrlFilterChip[];
  resetHref: string;
  searchMaxCharacters: number;
  exportMaxPosts: number;
  exportMaxBytes: number;
  locale?: KitLocale;
  canExport: boolean;
}) {
  const { copy } = useContent();
  const labels = usePublishingCopy(locale);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [exporting, setExporting] = useState(false);

  /** Rewrites one parameter and drops the page number, because a new filter starts on page 1. */
  const go = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value); else next.delete(name);
    next.delete('page'); next.delete('post');
    const query = next.toString();
    router.push(`${pathname}${query ? `?${query}` : ''}`);
  };
  const status = params.get('status') ?? '';
  const origin = params.get('origin') ?? '';
  const q = params.get('q') ?? '';
  const hidden: ReactNode[] = [];
  for (const name of ['channel', 'status', 'origin']) { const value = params.get(name); if (value) hidden.push(<input key={name} type="hidden" name={name} value={value} />); }

  return <div className={styles.filterRow}>
    <FilterButton activeCount={chips.length} onClear={() => router.push(resetHref)}>
      <div className={styles.filterBody}>
        <label>{copy.contentFilterStatus}
          <select value={status} onChange={event => go('status', event.currentTarget.value)}>
            <option value="">{copy.contentFilterAnyStatus}</option>
            <optgroup label={labels.groupPlanned}>
              {statuses.filter(item => postGroup(item.value) === 'planned').map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </optgroup>
            <optgroup label={labels.groupOutcome}>
              {statuses.filter(item => postGroup(item.value) === 'outcome').map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </optgroup>
          </select>
        </label>
        {origins.length ? <label>{copy.contentFilterOrigin}
          <select value={origin} onChange={event => go('origin', event.currentTarget.value)}>
            <option value="">{copy.contentFilterAnyOrigin}</option>
            {origins.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}
          </select>
        </label> : null}
        <SavedViews screen="posts" />
      </div>
    </FilterButton>
    <form className={styles.search} role="search" action={pathname} method="get">
      {hidden}
      <input type="search" name="q" key={q} defaultValue={q} maxLength={searchMaxCharacters} placeholder={copy.contentSearchPlaceholder} aria-label={copy.contentSearch} />
      <button type="submit" className="ui-visually-hidden">{copy.contentSearchGo}</button>
    </form>
    <UrlFilterChips chips={chips} resetHref={resetHref} locale={locale} labels={{ active: labels.activeFilters, remove: labels.removeFilter, reset: copy.contentFilterClear }} />
    {canExport ? <>
      <Button variant="secondary" size="sm" leading={<IconDownload size={16} aria-hidden="true" />} onClick={() => setExporting(true)}>{copy.postsExport}</Button>
      <Drawer open={exporting} title={copy.postsExportTitle} closeLabel={copy.createClose} onClose={() => setExporting(false)}>
        <div className={styles.exportBody}><PostExport maxPosts={exportMaxPosts} maxBytes={exportMaxBytes} locale={locale} /></div>
      </Drawer>
    </> : null}
  </div>;
}
