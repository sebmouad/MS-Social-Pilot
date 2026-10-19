'use client';

import { SidebarDock } from '@/components/SidebarDock';
import styles from './collaboration.module.css';

export const VIEWS = [
  { id: 'assign', title: 'Labels on posts' },
  { id: 'fields', title: 'Custom fields' },
  { id: 'queue', title: 'Queue times' },
  { id: 'mix', title: 'Content mix' },
] as const;
export type ViewId = (typeof VIEWS)[number]['id'];

/** Contextual navigation lives in the shell sidebar; the active view is exposed to assistive technology. */
export function CollaborationNav({ view, available = VIEWS.map(v => v.id), children }: { view: ViewId; available?: readonly ViewId[]; children?: React.ReactNode }) {
  return <SidebarDock>
    <nav className={styles.nav} aria-label="Post organization">
      {VIEWS.filter(item => available.includes(item.id)).map(item => <a key={item.id} href={`/publishing/collaboration?view=${item.id}`} aria-current={item.id === view ? 'page' : undefined}>{item.title}</a>)}
    </nav>
    {children}
  </SidebarDock>;
}
