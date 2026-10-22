'use client';
import { usePublishingCopy } from '../kit/CopyProvider';

import type { ChannelGroup } from '@/modules/settings/channel-profiles/contracts';
import { profileCopy } from '@/modules/settings/channel-profiles/copy';
import { usePathname, useSearchParams } from 'next/navigation';
import { PublishingChannelOptions } from '@/modules/publishing/ui/PublishingChannelOptions';
import styles from '@/modules/publishing/ui/publishing.module.css';
import { PostExport } from './PostExport';
import { originCopy } from '../origins/copy';

const statuses = [
  'draft', 'pending_approval', 'rejected',
  'scheduled', 'publishing', 'published',
  'partially_failed', 'failed', 'cancelled',
] as const;

export type PostView = 'table' | 'feed' | 'cards';
export function parsePostView(value: string | null | undefined): PostView {
  return value === 'feed' || value === 'cards' ? value : 'table';
}

export function PostFilters({ groups = [], locale = 'en', channels, currentMonth, searchMaxCharacters, exportMaxPosts, exportMaxBytes, origins = [] }: { groups?: ChannelGroup[]; locale?: 'en' | 'fr'; channels: Array<{ id: string; name: string }>; currentMonth: string; searchMaxCharacters?: number; exportMaxPosts?: number; exportMaxBytes?: number; origins?: Array<{ kind: string; label: string }> }) {
  const copy = usePublishingCopy(locale);
  const pathname = usePathname();
  const params = useSearchParams();
  if (pathname === '/publishing/calendar') return <form noValidate action="/publishing/calendar" method="get" className={styles.postFilters} key={params.toString()}>
    <p className="shell-subnav__label">{copy.calendarTitle}</p>
    <label htmlFor="calendar-month-filter">{copy.month}</label>
    <input id="calendar-month-filter" type="month" name="month" defaultValue={params.get('month') ?? currentMonth} />
    <button type="submit">{copy.showMonth}</button>
    <a href="/publishing/calendar">{copy.currentMonth}</a>
  </form>;
  return <>
    <form noValidate action="/publishing/posts" method="get" className={styles.postFilters} key={params.toString()}>
    <p className="shell-subnav__label">{copy.postFilters}</p>
    <label htmlFor="post-view-filter">{copy.view}</label>
    <select id="post-view-filter" name="view" defaultValue={parsePostView(params.get('view'))}>
      <option value="table">{copy.viewTable}</option>
      <option value="feed">{copy.viewFeed}</option>
      <option value="cards">{copy.viewCards}</option>
    </select>
    <label htmlFor="post-status-filter">{copy.status}</label>
    <select id="post-status-filter" name="status" defaultValue={params.get('status') ?? ''}>
      <option value="">{copy.allStatuses}</option>
      {statuses.map((value) => <option value={value} key={value}>{copy[`status_${value}`]}</option>)}
    </select>
    <label htmlFor="post-channel-filter">{copy.channel}</label>
    <select id="post-channel-filter" name="channel" defaultValue={params.get('channel') ?? ''}>
      <PublishingChannelOptions channels={channels} selected={params.get("channel")} groupIds={groups.map(group => group.id)} />
      {groups.length > 0 && <optgroup label={profileCopy[locale].groups}>{groups.filter(group => group.channelIds.some(id => channels.some(channel => channel.id === id))).map(group => <option key={group.id} value={`channel-group:${group.id}`}>{group.name}</option>)}</optgroup>}
    </select>
    {origins.length ? <>
      <label htmlFor="post-origin-filter">{originCopy[locale].filterLabel}</label>
      <select id="post-origin-filter" name="origin" defaultValue={params.get('origin') ?? ''}>
        <option value="">{originCopy[locale].anyOrigin}</option>
        {origins.map(option => <option value={option.kind} key={option.kind}>{option.label}</option>)}
      </select>
    </> : null}
    <label htmlFor="post-search-filter">{copy.searchPosts}</label>
    <input id="post-search-filter" type="search" name="q" maxLength={searchMaxCharacters} defaultValue={params.get('q') ?? ''} placeholder={copy.searchPlaceholder} aria-describedby="post-search-help" />
    <p id="post-search-help" className={styles.help}>{copy.searchHelp}</p>
    <button type="submit">{copy.applyFilters}</button>
    <a href="/publishing/posts">{copy.resetFiltersButton}</a>
    </form>
    {exportMaxPosts !== undefined && exportMaxBytes !== undefined ? <PostExport maxPosts={exportMaxPosts} maxBytes={exportMaxBytes} locale={locale} /> : null}
  </>;
}
