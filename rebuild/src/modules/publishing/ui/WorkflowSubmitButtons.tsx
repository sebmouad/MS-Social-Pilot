'use client';

import { useFormStatus } from 'react-dom';
import styles from './workflow.module.css';

export function CancelScheduleButton() {
  const { pending } = useFormStatus();
  return <button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={pending} aria-disabled={pending}>
    {pending ? 'Cancelling…' : 'Cancel schedule'}
  </button>;
}

export function ReviewButtons() {
  const { pending } = useFormStatus();
  return <div className={styles.reviewButtons} aria-busy={pending}>
    <button className="ui-button ui-button--primary ui-button--sm" type="submit" name="decision" value="approve" disabled={pending} aria-disabled={pending}>{pending ? 'Saving…' : 'Approve'}</button>
    <button className="ui-button ui-button--secondary ui-button--sm" type="submit" name="decision" value="reject" disabled={pending} aria-disabled={pending}>{pending ? 'Saving…' : 'Reject'}</button>
  </div>;
}
