"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components';
import { isOperationErrorCode } from '@/lib/operation-error';
import styles from '../publishing.module.css';

type DuplicateReceipt = {
  sourcePostId: string;
  postId: string;
  draftCreated: true;
  replayed: boolean;
};

const UNKNOWN_RESULT = 'The copy result could not be confirmed.';

function isDuplicateReceipt(value: unknown): value is DuplicateReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<DuplicateReceipt>;
  return typeof receipt.sourcePostId === 'string'
    && typeof receipt.postId === 'string'
    && receipt.draftCreated === true
    && typeof receipt.replayed === 'boolean';
}

export function DuplicatePost({ postId: sourceId, disabled = false, onPendingChange }: { postId: string; disabled?: boolean; onPendingChange?: (pending: boolean) => void }) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (error && !pending) errorRef.current?.focus();
  }, [error, pending]);

  async function duplicate() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    if (requestId.current === null) requestId.current = crypto.randomUUID();
    onPendingChange?.(true);
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/publishing/duplicate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postId: sourceId,
          requestId: requestId.current,
          confirmation: `DUPLICATE POST ${sourceId}`,
        }),
      });
      const receipt: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (receipt && typeof receipt === 'object') {
          const failure = receipt as { code?: unknown; error?: unknown };
          if (isOperationErrorCode(failure.code) && failure.code !== 'upstream_failure'
            && typeof failure.error === 'string' && failure.error.trim()) {
            setError(failure.error);
            return;
          }
        }
        setError(UNKNOWN_RESULT);
        return;
      }
      if (!isDuplicateReceipt(receipt)
        || receipt.sourcePostId !== sourceId
        || receipt.postId !== requestId.current
        || receipt.draftCreated !== true) {
        throw new Error(UNKNOWN_RESULT);
      }
      requestId.current = null;
      router.push('/publishing/posts?status=draft&notice=duplicated');
      router.refresh();
    } catch {
      setError(UNKNOWN_RESULT);
    } finally {
      inFlight.current = false;
      onPendingChange?.(false);
      setPending(false);
    }
  }

  return <div aria-busy={pending || undefined}>
    <Button type="button" variant="secondary" disabled={disabled || pending} onClick={() => void duplicate()}>
      {pending ? 'Copying…' : 'Duplicate as draft'}
    </Button>
    <p className={styles.help}>Creates a new unscheduled draft with the content, first comment, media, and currently selected destinations copied. No changes are made on destinations.</p>
    {error ? <p className={styles.formError} role="alert" tabIndex={-1} ref={errorRef}>{error} <a href="/publishing/posts?status=draft" target="_blank" rel="noopener noreferrer">Check Drafts</a> before trying again.</p> : null}
  </div>;
}
