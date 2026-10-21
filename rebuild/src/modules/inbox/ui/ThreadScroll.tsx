'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './inbox.module.css';

/**
 * Scrollable, keyboard-focusable message history. It opens on the newest entry;
 * `resetKey` changes with the open conversation and history page so each one
 * starts at the newest message.
 */
export function ThreadScroll({ label, resetKey, children }: { label: string; resetKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [resetKey]);
  return <div ref={ref} className={styles.threadScroll} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
