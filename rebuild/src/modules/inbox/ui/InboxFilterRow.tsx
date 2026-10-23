'use client';
import { useInboxCatalog } from './copy-context';

import { useRef, useState } from 'react';

import { FilterButton, FilterSection, Select, TextInput } from '@/components';
import { reviewText } from '@/modules/inbox/reviews-copy';
import type { InboxLocale } from './copy';
import styles from './inbox-round3.module.css';

type Filters = { channelId: string | null; kind: string; state: string; hidden: string; q: string };

/**
 * The Inbox filter row (design v2 S8): the page's single Filter button (type, status, hidden comments, page size)
 * and a search box. Both are one ordinary GET form, so filters live in the URL and work without script; choosing a value
 * applies it straight away and Enter applies the search. Quick filters and the active chips sit with the list.
 */
export function InboxFilterRow({ action, filters, scope, locale, thread, limit, maxLimit, searchMaxCharacters, resetHref, disabledLimit, quick = [], activeCount }: {
  /** The sidebar's channel scope (`channel=a,b`), carried through the form so filtering keeps it. The channel is chosen in the sidebar, not here. */
  scope?: string;
  action: string; filters: Filters; locale: InboxLocale; thread?: string;
  limit?: number; maxLimit?: number; searchMaxCharacters?: number; resetHref: string; disabledLimit: boolean; quick?: readonly string[]; activeCount: number;
}) {
  const reviews = useInboxCatalog('reviewCopy');
  const copy = useInboxCatalog('inboxCopy')[locale];
  const screen = useInboxCatalog('round3Copy')[locale].screen;
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState(filters.kind === 'all' ? 'message' : filters.kind);
  const [state, setState] = useState(filters.state);
  const [hidden, setHidden] = useState(filters.hidden);
  const apply = () => setTimeout(() => form.current?.requestSubmit(), 0);
  return <form ref={form} method="get" action={action} noValidate className={styles.filterRow}>
    {thread ? <input type="hidden" name="thread" value={thread} /> : null}
    {scope ? <input type="hidden" name="channel" value={scope} /> : null}
    {quick.length ? <input type="hidden" name="quick" value={quick.join(',')} /> : null}
    <FilterButton activeCount={activeCount} title={screen.filterTitle} onClear={() => window.location.assign(resetHref)}>
      <FilterSection label={copy.type}>
        <Select name="type" aria-label={copy.type} value={kind} onChange={value => { setKind(value); apply(); }}
          options={[{ value: 'message', label: copy.messages }, { value: 'comment', label: copy.comments }, { value: 'review', label: reviewText(locale, 'reviews', {}, reviews) }]} />
      </FilterSection>
      <FilterSection label={copy.status}>
        <Select name="status" aria-label={copy.status} value={state} onChange={value => { setState(value); apply(); }}
          options={[{ value: 'open', label: copy.open }, { value: 'resolved', label: copy.resolved }, { value: 'all', label: copy.all }]} />
      </FilterSection>
      <FilterSection label={copy.hiddenComments}>
        <Select name="hidden" aria-label={copy.hiddenComments} value={hidden} onChange={value => { setHidden(value); apply(); }}
          options={[{ value: 'visible', label: copy.hideThem }, { value: 'all', label: copy.showThem }]} />
      </FilterSection>
      <FilterSection label={copy.perPage}>
        <TextInput type="number" name="limit" aria-label={copy.perPage} min={1} max={maxLimit} defaultValue={limit} disabled={disabledLimit} />
      </FilterSection>
    </FilterButton>
    <div role="search" aria-label={screen.search} className={styles.filterSearch}>
      <TextInput type="search" name="q" aria-label={screen.search} maxLength={searchMaxCharacters} defaultValue={filters.q} placeholder={copy.searchPlaceholder} />
    </div>
  </form>;
}
