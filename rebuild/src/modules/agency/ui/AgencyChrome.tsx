import type { ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import styles from './agency.module.css';

export function AgencyHeading({ description }: { description: string }) {
  return <PageHeader module="agency" title="Client workspaces" description={description} />;
}

export function AgencyShell({ children }: { children: ReactNode }) {
  return <div className={styles.root} data-module="agency">{children}</div>;
}

export const formatDate = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
