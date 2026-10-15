'use client';

import { useSearchParams } from 'next/navigation';
import styles from '../publishing.module.css';

const statuses = [
  ['draft', 'Draft'], ['pending_approval', 'Pending Approval'], ['rejected', 'Rejected'],
  ['scheduled', 'Scheduled'], ['publishing', 'Publishing'], ['published', 'Published'],
  ['partially_failed', 'Partially Failed'], ['failed', 'Failed'], ['cancelled', 'Cancelled'],
] as const;

export function PostFilters({ channels }: { channels: Array<{ id: string; name: string }> }) {
  const params = useSearchParams();
  return <form action="/publishing/posts" method="get" className={styles.postFilters} key={params.toString()}>
    <p className="shell-subnav__label">Post Filters</p>
    <label htmlFor="post-status-filter">Status</label>
    <select id="post-status-filter" name="status" defaultValue={params.get('status') ?? ''}>
      <option value="">All statuses</option>
      {statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select>
    <label htmlFor="post-channel-filter">Channel</label>
    <select id="post-channel-filter" name="channel" defaultValue={params.get('channel') ?? ''}>
      <option value="">All accessible channels</option>
      {channels.map(channel => <option value={channel.id} key={channel.id}>{channel.name}</option>)}
    </select>
    <button type="submit">Apply Filters</button>
    <a href="/publishing/posts">Reset Filters</a>
  </form>;
}
