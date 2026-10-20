'use client';

import { useRef, useState } from 'react';
import { FilterPanel, FilterSection, Select, TextInput } from '@/components';
import { Button } from '@/components/Button';
import { reviewText } from '@/modules/inbox/reviews-copy';
import { inboxCopy, type InboxLocale } from './copy';

type Filters = { channelId: string | null; kind: string; state: string; hidden: string; q: string };

/**
 * Inbox filters in the contextual sidebar. It is an ordinary GET form, so filters live in the URL and work
 * without script; choosing a value in a list applies it straight away and Enter applies the search.
 */
export function InboxFilterPanel({ action, filters, channels, locale, thread, limit, maxLimit, searchMaxCharacters, resetHref, disabledLimit }: {
  action: string; filters: Filters; channels: Array<{ id: string; name: string }>; locale: InboxLocale; thread?: string;
  limit?: number; maxLimit?: number; searchMaxCharacters?: number; resetHref: string; disabledLimit: boolean;
}) {
  const copy = inboxCopy[locale];
  const form = useRef<HTMLFormElement>(null);
  const [channel, setChannel] = useState(filters.channelId ?? 'all');
  const [kind, setKind] = useState(filters.kind);
  const [state, setState] = useState(filters.state);
  const [hidden, setHidden] = useState(filters.hidden);
  const apply = () => setTimeout(() => form.current?.requestSubmit(), 0);
  const active = [filters.channelId, filters.kind !== 'all' ? filters.kind : '', filters.state !== 'open' ? filters.state : '', filters.hidden !== 'visible' ? filters.hidden : '', filters.q].filter(Boolean).length;
  return <FilterPanel title={copy.filters} activeCount={active} resetLabel={copy.resetFilters} onReset={() => window.location.assign(resetHref)}>
    <form ref={form} method="get" action={action} noValidate>
      {thread ? <input type="hidden" name="thread" value={thread} /> : null}
      <FilterSection label={copy.search}>
        <TextInput type="search" name="q" aria-label={copy.search} maxLength={searchMaxCharacters} defaultValue={filters.q} placeholder={copy.searchPlaceholder} />
      </FilterSection>
      <FilterSection label={copy.channel}>
        <Select name="channel" aria-label={copy.channel} value={channel} searchableonChange={value => { setChannel(value); apply(); }}
          options={[{ value: 'all', label: copy.allChannels }, ...channels.map(item => ({ value: item.id, label: item.name }))]} />
      </FilterSection>
      <FilterSection label={copy.type}>
        <Select name="type" aria-label={copy.type} value={kind} onChange={value => { setKind(value); apply(); }}
          options={[{ value: 'all', label: copy.allTypes }, { value: 'message', label: copy.messages }, { value: 'comment', label: copy.comments }, { value: 'review', label: reviewText(locale, 'reviews') }]} />
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
      <Button variant="primary" type="submit">{copy.applyFilters}</Button>
    </form>
  </FilterPanel>;
}
