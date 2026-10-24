"use client";
import { useEffect, useRef, useState } from "react";
import { publishPostAction } from "./actions";

import { usePublishingActionText } from '../WorkflowSubmitButtons';
import { publishingActionCopy, publishingActionText } from '../../action-catalog';
/** Compatibility export for consumers that need bootstrap defaults. */
export const publishNowCopy = Object.fromEntries((['en', 'fr'] as const).map(locale => {
  const t = publishingActionText(publishingActionCopy, locale);
  return [locale, { publish: t('publishNow'), undo: t('undo'), countdown: (seconds: number) => t('countdown', { seconds }) }];
})) as Record<'en' | 'fr', { publish: string; undo: string; countdown: (seconds: number) => string }>;

/**
 * "Publish now" with the workspace's undo-send window: nothing is sent while the
 * countdown runs, and Undo (or leaving the page) cancels it. A window of 0
 * submits straight away.
 */
export function PublishNowButton({ postId, undoSendSeconds, disabled = false }: { postId: string; undoSendSeconds: number; disabled?: boolean }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const t = usePublishingActionText();
  const copy = { publish: t('publishNow'), undo: t('undo'), countdown: (seconds: number) => t('countdown', { seconds }) };
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) { setRemaining(null); formRef.current?.requestSubmit(); return; }
    const timer = setTimeout(() => setRemaining(current => (current === null ? null : current - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  const counting = remaining !== null;
  return <form ref={formRef} noValidate action={publishPostAction}>
    <input type="hidden" name="postId" value={postId} />
    {counting ? <>
      <span role="status" aria-live="polite">{copy.countdown(remaining)}</span>{" "}
      <button className="ui-button ui-button--secondary ui-button--sm" type="button" onClick={() => setRemaining(null)}>{copy.undo}</button>
    </> : <button className="ui-button ui-button--primary ui-button--sm" type="button" disabled={disabled}
      onClick={() => { if (undoSendSeconds > 0) setRemaining(undoSendSeconds); else formRef.current?.requestSubmit(); }}>{copy.publish}</button>}
  </form>;
}
