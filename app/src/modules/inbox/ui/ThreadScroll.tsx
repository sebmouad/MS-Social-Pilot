'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './inbox.module.css';

/** Opens each history page at its newest entry. Live refreshes follow the end
 * only while the reader is already there; reading older entries keeps position.
 */
export function ThreadScroll({ label, resetKey, children }: { label: string; resetKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const previousKey = useRef<string | null>(null);
  const followEnd = useRef(true);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && (previousKey.current !== resetKey || followEnd.current)) {
      node.scrollTop = node.scrollHeight;
      followEnd.current = true;
    }
    previousKey.current = resetKey;
  }, [resetKey, children]);
  return <div ref={ref} className={styles.threadScroll} role="region" aria-label={label} tabIndex={0} data-thread-scroll
    onScroll={event => { const node = event.currentTarget; followEnd.current = node.scrollTop + node.clientHeight >= node.scrollHeight; }}>{children}</div>;
}
