'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { PublishingChannelOptions } from '@/modules/publishing/ui/PublishingChannelOptions';
import styles from '@/modules/publishing/ui/publishing.module.css';
import { PostExport } from './PostExport';

const statuses = [
  ['draft', 'Draft'], ['pending_approval', 'Pending Approval'], ['rejected', 'Rejected'],
  ['scheduled', 'Scheduled'], ['publishing', 'Publishing'], ['published', 'Published'],
  ['partially_failed', 'Partially Failed'], ['failed', 'Failed'], ['cancelled', 'Cancelled'],
] as const;

export type PostView = 'table' | 'feed' | 'cards';
export function parsePostView(value: string | null | undefined): PostView {
  return value === 'feed' || value === 'cards' ? value : 'table';
}

export function PostFilters({ channels, currentMonth, searchMaxCharacters, exportMaxPosts, exportMaxBytes }: { channels: Array<{ id: string; name: string }>; currentMonth: string; searchMaxCharacters?: number; exportMaxPosts?: number; exportMaxBytes?: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (pathname === '/publishing/calendar') return <form noValidate action="/publishing/calendar" method="get" className={styles.postFilters} key={params.toString()}>
    <p className="shell-subnav__label">Calendar</p>
    <label htmlFor="calendar-month-filter">Month</label>
    <input id="calendar-month-filter" type="month" name="month" defaultValue={params.get('month') ?? currentMonth} />
    <button type="submit">Show Month</button>
    <a href="/publishing/calendar">Current Month</a>
  </form>;
  return <>
    <form noValidate action="/publishing/posts" method="get" className={styles.postFilters} key={params.toString()}>
    <p className="shell-subnav__label">Post Filters</p>
    <label htmlFor="post-view-filter">View</label>
    <select id="post-view-filter" name="view" defaultValue={parsePostView(params.get('view'))}>
      <option value="table">Table</option>
      <option value="feed">Feed</option>
      <option value="cards">Cards</option>
    </select>
    <label htmlFor="post-status-filter">Status</label>
    <select id="post-status-filter" name="status" defaultValue={params.get('status') ?? ''}>
      <option value="">All statuses</option>
      {statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select>
    <label htmlFor="post-channel-filter">Channel</label>
    <select id="post-channel-filter" name="channel" defaultValue={params.get('channel') ?? ''}>
      <PublishingChannelOptions channels={channels} selected={params.get("channel")} />
    </select>
    <label htmlFor="post-search-filter">Search posts</label>
    <input id="post-search-filter" type="search" name="q" maxLength={searchMaxCharacters} defaultValue={params.get('q') ?? ''} placeholder="Post text or first comment" aria-describedby="post-search-help" />
    <p id="post-search-help" className={styles.help}>Search post text and first comments.</p>
    <button type="submit">Apply Filters</button>
    <a href="/publishing/posts">Reset Filters</a>
    </form>
    {exportMaxPosts !== undefined && exportMaxBytes !== undefined ? <PostExport maxPosts={exportMaxPosts} maxBytes={exportMaxBytes} /> : null}
  </>;
}
