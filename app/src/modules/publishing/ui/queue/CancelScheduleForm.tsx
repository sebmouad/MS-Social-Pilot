'use client';

import { useState, useTransition } from 'react';
import { usePublishingActionText } from '../WorkflowSubmitButtons';

/**
 * Cancels a scheduled post through the shared server action. A failed request (expired session, server error, offline) is
 * reported beside the post instead of replacing the page with the error boundary, so other typed input on the page survives.
 */
export function CancelScheduleForm({ postId, action, locale }: { postId: string; action: (data: FormData) => Promise<void>; locale?: 'en' | 'fr' }) {
  const t = usePublishingActionText(locale);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return <form noValidate onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFailed(false);
    start(async () => { try { await action(data); } catch { setFailed(true); } });
  }}>
    <input type="hidden" name="postId" value={postId} />
    <button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={pending} aria-disabled={pending}>{pending ? t('workflow_cancelling') : t('cancelSchedule')}</button>
    {failed && <p role="alert" className="ui-error">{t('workflow_cancelFailed')}</p>}
  </form>;
}
