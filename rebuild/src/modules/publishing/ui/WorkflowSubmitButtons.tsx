'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { publishingActionCopy, publishingActionText, type PublishingActionCopy } from '../action-catalog';
import styles from './workflow.module.css';

const ActionCopyContext = createContext<{ catalog: PublishingActionCopy; locale?: string }>({ catalog: publishingActionCopy });
export function PublishingActionCopyProvider({ catalog, locale, children }: { catalog: PublishingActionCopy; locale?: string; children: ReactNode }) {
  const value = useMemo(() => ({ catalog, locale }), [catalog, locale]);
  return <ActionCopyContext.Provider value={value}>{children}</ActionCopyContext.Provider>;
}
/** The workspace locale the server rendered with; used for number formatting so SSR and hydration agree. */
export function usePublishingActionLocale() { return useContext(ActionCopyContext).locale; }
export function usePublishingActionText(locale?: string) {
  const context = useContext(ActionCopyContext);
  const [browserLocale, setBrowserLocale] = useState('en');
  useEffect(() => { setBrowserLocale(document.documentElement.lang || navigator.language); }, []);
  return useMemo(() => publishingActionText(context.catalog, locale ?? context.locale ?? browserLocale), [context.catalog, context.locale, locale, browserLocale]);
}
export function CancelScheduleButton({ locale }: { locale?: 'en' | 'fr' }) {
  const { pending } = useFormStatus();
  const t = usePublishingActionText(locale);
  return <button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={pending} aria-disabled={pending}>
    {pending ? t('workflow_cancelling') : t('cancelSchedule')}
  </button>;
}
export function ReviewButtons({ locale }: { locale?: 'en' | 'fr' }) {
  const { pending } = useFormStatus();
  const t = usePublishingActionText(locale);
  return <div className={styles.reviewButtons} aria-busy={pending}>
    <button className="ui-button ui-button--primary ui-button--sm" type="submit" name="decision" value="approve" disabled={pending} aria-disabled={pending}>{pending ? t('saving') : t('approve')}</button>
    <button className="ui-button ui-button--secondary ui-button--sm" type="submit" name="decision" value="reject" disabled={pending} aria-disabled={pending}>{pending ? t('saving') : t('reject')}</button>
  </div>;
}
