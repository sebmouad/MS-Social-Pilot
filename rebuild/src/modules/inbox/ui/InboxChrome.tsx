import { resolveInboxCatalog, type InboxCustomerCopy } from '../customer-copy';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ShortcutHint as Keycap } from '@/components/ShortcutHint';
import { PageGlyph } from '@/components/icons';
import styles from './inbox-chrome.module.css';

/** Inbox page header: the shared PageHeader with the Inbox icon chip. */
export function InboxHeader({ href = '/inbox', title, description, actions }: { href?: string; eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <PageHeader module="inbox" icon={href ? <PageGlyph href={href} size={22} /> : undefined} title={title} description={description} actions={actions} />;
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


/** The keys InboxShortcuts listens for, shown as shared keycaps next to what they do. */
export function ShortcutHint({ locale = 'en', catalog }: { locale?: 'en' | 'fr'; catalog?: InboxCustomerCopy }) {
  const copy = resolveInboxCatalog('SHORTCUT_COPY', catalog)[locale];
  return <p className={styles.shortcuts} aria-label={copy.title}>
    <span><Keycap chord="j" /> {copy.next}</span><span><Keycap chord="k" /> {copy.previous}</span><span><Keycap chord="r" /> {copy.reply}</span><span><Keycap chord="e" /> {copy.resolve}</span>
  </p>;
}
