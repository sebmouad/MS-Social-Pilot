import type { ReactNode } from 'react';
import { PageFrame } from '@/server/PageFrame';
import styles from '@/modules/publishing/ui/publishing.module.css';

/**
 * Content area (design v2): Posts, Calendar, Queue, Approvals and Library share the single sidebar shell.
 * Filters live in each page's header Filter button, so this layout mounts no sidebar tools.
 */
export default async function ContentLayout({ children }: { children: ReactNode }) {
  return <PageFrame module="publishing" scopedAccess><div className={styles.page}>{children}</div></PageFrame>;
}
