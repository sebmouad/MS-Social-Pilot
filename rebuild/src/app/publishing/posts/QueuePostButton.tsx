'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { formatDate } from '../publishing-ui';

type QueueReceipt = { postId: string; status: 'scheduled' | 'pending_approval'; scheduledAt: string };

export function QueuePostButton({ postId, postMessage, destinations, timeZone, eligible = true }: { postId: string; postMessage: string; destinations: string[]; timeZone: string; eligible?: boolean }) {
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
      if (!response.ok) throw new Error(result && 'error' in result && typeof result.error === 'string' ? result.error : 'The post could not be added to the queue. Review it and try again.');
      if (!result || !('postId' in result) || result.postId !== postId || !['scheduled', 'pending_approval'].includes(result.status) || typeof result.scheduledAt !== 'string' || !Number.isFinite(Date.parse(result.scheduledAt))) {
        throw new Error('The queue response could not be verified. Refresh the post list before retrying.');
      }
      const scheduledAt = formatDate(new Date(result.scheduledAt), timeZone);
      setSuccess(result.status === 'pending_approval'
        ? `Post added to the queue for ${scheduledAt}. It still needs approval before it can publish.`
        : `Post added to the queue for ${scheduledAt}.`);
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The queue request could not be confirmed. Refresh the post list before retrying.');
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  return <>
    {eligible ? <Button size="sm" disabled={busy} onClick={() => { setError(''); setOpen(true); }}>Add to queue</Button> : null}
    <p role="status" aria-live="polite">{success}</p>
    <Dialog open={open} title="Review queue placement" description="The next saved queue time will be assigned when you confirm. Approval may be required before the post can publish; the queue will show the time the server allocates." busy={busy} onClose={() => !busy && setOpen(false)} actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void queue()}>{busy ? 'Adding to queue…' : 'Add to queue'}</Button></>}>
      <section aria-label="Post being queued">
        <p><strong>Post text</strong></p>
        <p style={{ overflowWrap: 'anywhere' }}>{postMessage || 'No post text'}</p>
        <p><strong>Pending destinations</strong></p>
        <ul>{destinations.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>
      </section>
      {error ? <p role="alert" tabIndex={-1}>{error}</p> : null}
    </Dialog>
  </>;
}
