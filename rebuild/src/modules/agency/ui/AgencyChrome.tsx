import { uiCopy, type CustomerCopy, type UiLocale } from './copy';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import styles from './agency.module.css';

export function AgencyHeading({ description, locale = 'en', copy }: { description: string; copy?: CustomerCopy; locale?: UiLocale }) {
  return <PageHeader module="agency" title={uiCopy(locale, copy)('Client workspaces')} description={description} />;
}

export function AgencyShell({ children }: { children: ReactNode }) {
  return <div className={styles.root} data-module="agency">{children}</div>;
}

export const formatDate = (value: string, locale: UiLocale = 'en') => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
