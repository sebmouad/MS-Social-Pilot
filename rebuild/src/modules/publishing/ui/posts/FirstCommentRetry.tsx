'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';

import { usePublishingActionText } from '../WorkflowSubmitButtons';
import { publishingActionCopy, publishingActionText } from '../../action-catalog';
const retryKeys = ['retry', 'title', 'cancel', 'description', 'confirmation', 'pending', 'failed', 'held', 'sent', 'rejected', 'status', 'unavailable'] as const;
export const firstCommentRetryCopy = Object.fromEntries((['en', 'fr'] as const).map(locale => {
  const t = publishingActionText(publishingActionCopy, locale);
  return [locale, Object.fromEntries(retryKeys.map(key => [key, t(`retry_${key}`)]))];
})) as Record<'en' | 'fr', Record<typeof retryKeys[number], string>>;

type State = 'sent' | 'ready' | 'needs_review';
export function FirstCommentRetry({ postId, postTargetId, destinationName, onSettled }: { postId: string; postTargetId: string; destinationName?: string | null; onSettled: (state: State) => void }) {
  const t = usePublishingActionText();
  const c = Object.fromEntries(retryKeys.map(key => [key, t(`retry_${key}`)])) as Record<typeof retryKeys[number], string>;
  const router = useRouter();
  const running = useRef(false);
  const held = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, dialog] = useConfirm({ title: c.title, cancel: c.cancel, confirm: c.retry, danger: false });

  async function retry() {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage('');
    let outcome: State | undefined;
    try {
      await confirm(`${destinationName ?? c.unavailable}: ${c.description}`, {
        exactConfirmation: `RETRY FIRST COMMENT ${postTargetId}`, confirmationLabel: c.confirmation, pendingLabel: c.pending, failureLabel: c.held,
        onConfirm: async () => {
          if (held.current) return c.held;
          try {
            const response = await fetch('/api/publishing/first-comments/retry', { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ postId, postTargetId, confirmation: `RETRY FIRST COMMENT ${postTargetId}` }) });
            const result = await response.json().catch(() => null);
            if (!response.ok) {
              if (['invalid_request', 'forbidden', 'unauthorized', 'not_found', 'unavailable'].includes(result?.code)) return c.failed;
              throw new Error('Unconfirmed retry');
            }
            if (result?.ok !== true || result.postId !== postId || result.postTargetId !== postTargetId || !['sent', 'ready', 'needs_review'].includes(result.state)) throw new Error('Unconfirmed retry');
            if (result.state === 'needs_review') throw new Error('Uncertain retry');
            outcome = result.state;
            setMessage(result.state === 'sent' ? c.sent : c.rejected);
            return null;
          } catch {
            held.current = true; outcome = 'needs_review'; return c.held;
          }
        },
      });
      if (outcome) {
        onSettled(outcome);
        try { router.refresh(); } catch { /* Keep the known local result. */ }
      }
    } finally { running.current = false; setBusy(false); }
  }

  return <>
    <span>{c.status}</span>
    <Button size="sm" disabled={busy || held.current} onClick={() => void retry()}>{c.retry}</Button>
    {message && <p role="status">{message}</p>}
    {dialog}
  </>;
}
