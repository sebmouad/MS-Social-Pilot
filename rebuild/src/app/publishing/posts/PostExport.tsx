'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/Button';
import styles from '../publishing.module.css';

type ExportProps = { maxPosts: number; maxBytes: number };

function safeOperationError(code: unknown) {
  if (code === 'unauthorized' || code === 'forbidden') return 'You do not have permission to export these posts.';
  if (code === 'invalid_request') return 'The export request was refused. Review the filters or narrow them to fit the configured export limit.';
  if (code === 'unavailable' || code === 'conflict' || code === 'reconnect_required') return 'The export is temporarily unavailable. Try again later or narrow the filters.';
  return 'The CSV could not be confirmed. Try again or narrow the filters.';
}

function validCount(value: string | null, maximum: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 && count <= maximum ? count : null;
}

function validBytes(value: string | null, maximum: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= maximum ? bytes : null;
}

export function PostExport({ maxPosts, maxBytes }: ExportProps) {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string; id: number } | null>(null);
  const inFlight = useRef(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const feedbackId = useRef(0);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback?.id]);

  function announce(kind: 'success' | 'error', text: string) {
    setFeedback({ kind, text, id: ++feedbackId.current });
  }

  async function exportPosts() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const query = new URLSearchParams();
      for (const key of ['q', 'status', 'channel']) {
        const value = params.get(key);
        if (value) query.set(key, value);
      }
      const response = await fetch(`/api/publishing/posts/export${query.size ? `?${query}` : ''}`, { method: 'GET', cache: 'no-store' });
      if (!response.ok) {
        let code: unknown;
        try { code = (await response.json() as { code?: unknown }).code; } catch { /* Keep the safe generic result. */ }
        announce('error', safeOperationError(code));
        return;
      }

      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      const count = validCount(response.headers.get('x-msp-post-count'), maxPosts);
      const declaredBytes = validBytes(response.headers.get('x-msp-export-bytes'), maxBytes);
      if (contentType !== 'text/csv' || response.headers.get('x-msp-export-format') !== 'posts-v1' || count === null || declaredBytes === null) {
        throw new Error('The CSV could not be confirmed. Try again or narrow the filters.');
      }
      const blob = await response.blob();
      if (blob.type && !blob.type.toLowerCase().startsWith('text/csv') || blob.size !== declaredBytes || blob.size > maxBytes) {
        throw new Error('The CSV could not be confirmed. Try again or narrow the filters.');
      }
      const url = URL.createObjectURL(blob);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'posts.csv';
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      announce('success', `Prepared CSV for ${count} ${count === 1 ? 'post' : 'posts'}.`);
    } catch {
      announce('error', 'The CSV could not be confirmed. Try again or narrow the filters.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section aria-label="Export posts">
    <p className={styles.help}>Export the complete set of posts matching your applied search, status, and channel filters across all pages, up to {maxPosts.toLocaleString()} posts and {maxBytes.toLocaleString()} bytes. The selected page and view do not limit the export.</p>
    <Button onClick={exportPosts} disabled={busy}>{busy ? 'Preparing CSV…' : 'Export matching posts'}</Button>
    {feedback ? <p ref={feedbackRef} tabIndex={-1} role={feedback.kind === 'error' ? 'alert' : 'status'} className={feedback.kind === 'error' ? styles.errorNotice : styles.successNotice}>{feedback.text}</p> : null}
  </section>;
}
