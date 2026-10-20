'use client';

import { useFormStatus } from 'react-dom';
import styles from './workflow.module.css';

const LABELS = {
  en: { cancel: 'Cancel schedule', cancelling: 'Cancelling…', approve: 'Approve', reject: 'Reject', saving: 'Saving…' },
  fr: { cancel: 'Annuler la programmation', cancelling: 'Annulation…', approve: 'Approuver', reject: 'Refuser', saving: 'Enregistrement…' },
} as const;

export function CancelScheduleButton({ locale = 'en' }: { locale?: 'en' | 'fr' }) {
  const { pending } = useFormStatus();
  const labels = LABELS[locale];
  return <button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={pending} aria-disabled={pending}>
    {pending ? labels.cancelling : labels.cancel}
  </button>;
}

export function ReviewButtons({ locale = 'en' }: { locale?: 'en' | 'fr' }) {
  const { pending } = useFormStatus();
  const labels = LABELS[locale];
  return <div className={styles.reviewButtons} aria-busy={pending}>
    <button className="ui-button ui-button--primary ui-button--sm" type="submit" name="decision" value="approve" disabled={pending} aria-disabled={pending}>{pending ? labels.saving : labels.approve}</button>
    <button className="ui-button ui-button--secondary ui-button--sm" type="submit" name="decision" value="reject" disabled={pending} aria-disabled={pending}>{pending ? labels.saving : labels.reject}</button>
  </div>;
}
