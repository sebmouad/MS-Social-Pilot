'use client';
import { usePublishingActionText } from '@/modules/publishing/ui/WorkflowSubmitButtons';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { formatDate } from '@/modules/publishing/ui/publishing-ui';

type QueueReceipt = { postId: string; status: 'scheduled' | 'pending_approval'; scheduledAt: string };

export function QueuePostButton({ postId, postMessage, destinations, timeZone, eligible = true }: { postId: string; postMessage: string; destinations: string[]; timeZone: string; eligible?: boolean }) {
  const t = usePublishingActionText();
  const router = useRouter();
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function queue() {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/publishing/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, confirmation: `QUEUE POST ${postId}` }),
      });
      const result = await response.json().catch(() => null) as QueueReceipt | { error?: string } | null;
      if (!response.ok) throw new Error(result && 'error' in result && typeof result.error === 'string' ? result.error : t('thePostCouldNotBeAddedTo'));
      if (!result || !('postId' in result) || result.postId !== postId || !['scheduled', 'pending_approval'].includes(result.status) || typeof result.scheduledAt !== 'string' || !Number.isFinite(Date.parse(result.scheduledAt))) {
        throw new Error(t('theQueueResponseCouldNotBeVerified'));
      }
      const scheduledAt = formatDate(new Date(result.scheduledAt), timeZone);
      setSuccess(result.status === 'pending_approval'
        ? t('queuedApproval', { time: scheduledAt })
        : t('queued', { time: scheduledAt }));
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('theQueueRequestCouldNotBeConfirmed'));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  return <>
    {eligible ? <Button size="sm" disabled={busy} onClick={() => { setError(''); setOpen(true); }}>{t('addToQueue')}</Button> : null}
    <p role="status" aria-live="polite">{success}</p>
    <Dialog open={open} title={t('reviewQueuePlacement')} description={t('theNextSavedQueueTimeWillBe')} busy={busy} onClose={() => !busy && setOpen(false)} actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => void queue()}>{busy ? t('addingToQueue') : t('addToQueue')}</Button></>}>
      <section aria-label={t('postBeingQueued')}>
        <p><strong>{t('postText')}</strong></p>
        <p style={{ overflowWrap: 'anywhere' }}>{postMessage || t('noPostText')}</p>
        <p><strong>{t('pendingDestinations')}</strong></p>
        <ul>{destinations.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>
      </section>
      {error ? <p role="alert" tabIndex={-1}>{error}</p> : null}
    </Dialog>
  </>;
}
