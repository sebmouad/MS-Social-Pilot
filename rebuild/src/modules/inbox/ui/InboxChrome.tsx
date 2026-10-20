import type { ReactNode } from 'react';
import { ModuleGlyph, PageGlyph } from '@/components/icons';
import styles from './inbox-chrome.module.css';

/**
 * Module-local header and avatar for the Inbox screens.
 * TODO: swap to the shared PageHeader and Avatar once the shared set lands.
 */
export function InboxHeader({ href = '/inbox', eyebrow, title, description, actions }: { href?: string; eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className={styles.header} data-module="inbox">
    <span className={styles.chip}>{href ? <PageGlyph href={href} size={22} /> : <ModuleGlyph id="inbox" size={22} />}</span>
    <div className={styles.headerText}><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1><p className={styles.description}>{description}</p></div>
    {actions ? <div className={styles.headerSide}>{actions}</div> : null}
  </header>;
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

export const SHORTCUT_COPY = {
  en: { title: 'Keyboard shortcuts', next: 'next', previous: 'previous', reply: 'reply', resolve: 'resolve or reopen', open: 'Open a conversation to reply or resolve it.' },
  fr: { title: 'Raccourcis clavier', next: 'suivante', previous: 'précédente', reply: 'répondre', resolve: 'résoudre ou rouvrir', open: 'Ouvrez une conversation pour répondre ou la résoudre.' },
} as const;

export function ShortcutHint({ locale = 'en' }: { locale?: 'en' | 'fr' }) {
  const copy = SHORTCUT_COPY[locale];
  return <p className={styles.shortcuts} aria-label={copy.title}>
    <span><kbd>j</kbd> {copy.next}</span><span><kbd>k</kbd> {copy.previous}</span><span><kbd>r</kbd> {copy.reply}</span><span><kbd>e</kbd> {copy.resolve}</span>
  </p>;
}
