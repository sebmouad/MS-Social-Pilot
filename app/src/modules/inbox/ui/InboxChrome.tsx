import type { ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import styles from './inbox-chrome.module.css';

/** Inbox page header (design v2): title with the waiting count and an ⓘ, then the Conversations | Rules tabs and the filter row. */
export function InboxHeader({ title, count, info, actions, tabs, filters }: { title: string; count?: ReactNode; info?: ReactNode; actions?: ReactNode; tabs?: ReactNode; filters?: ReactNode }) {
  return <PageHeader module="inbox" title={title} count={count} info={info} actions={actions} tabs={tabs} filters={filters} />;
}

const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';

function hue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--chart-${(hash % 8) + 1})`;
}

/** Initials avatar for a person; the colour is stable per name. */
export function PersonAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return <span className={styles.avatar} style={{ width: size, height: size, ['--avatar-hue' as string]: hue(name) }} aria-hidden="true">{initials(name)}</span>;
}

export { SHORTCUT_COPY } from '../shortcut-copy';
