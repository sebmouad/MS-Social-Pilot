import type { ReactNode } from 'react';
import styles from './agency.module.css';

export function AgencyHeading({ description }: { description: string }) {
  return <header className={styles.heading}><span className={styles.eyebrow}>Agency</span><h1>Client workspaces</h1><p>{description}</p></header>;
}

export function AgencyShell({ children }: { children: ReactNode }) {
  return <div className={styles.root}>{children}</div>;
}

export const formatDate = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
