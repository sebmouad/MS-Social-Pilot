'use client';

import { composerCatalogDefaults } from '../../composer-catalog';
import styles from './collaboration.module.css';
import { useCollaborationCopy } from '../compose/CopyProvider';

export const VIEWS = [
  { id: 'assign', title: composerCatalogDefaults.collab_assign.en },
  { id: 'fields', title: composerCatalogDefaults.collab_fields.en },
  { id: 'queue', title: composerCatalogDefaults.collab_queue.en },
  { id: 'mix', title: composerCatalogDefaults.collab_mix.en },
] as const;
export type ViewId = (typeof VIEWS)[number]['id'];

/** Contextual navigation lives in the shell sidebar; the active view is exposed to assistive technology. */
export function CollaborationNav({ view, available = VIEWS.map(v => v.id), children }: { view: ViewId; available?: readonly ViewId[]; children?: React.ReactNode }) {
  const c = useCollaborationCopy();
  return <div>
    <nav className={styles.nav} aria-label={c.post_organization}>
      {VIEWS.filter(item => available.includes(item.id)).map(item => <a key={item.id} href={`/content/library/fields?view=${item.id}`} aria-current={item.id === view ? 'page' : undefined}>{c[item.id === 'assign' ? 'assign' : item.id === 'fields' ? 'fields' : item.id === 'queue' ? 'queue' : 'mix']}</a>)}
    </nav>
    {children}
  </div>;
}
