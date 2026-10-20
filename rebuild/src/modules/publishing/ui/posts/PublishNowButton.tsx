"use client";
import { useEffect, useRef, useState } from "react";
import { publishPostAction } from "./actions";

/** Strings for the undo-send countdown; the Publishing catalog resolves the locale. */
export const publishNowCopy = {
  en: { publish: "Publish now", undo: "Undo", countdown: (seconds: number) => `Publishing in ${seconds} s` },
  fr: { publish: "Publier maintenant", undo: "Annuler", countdown: (seconds: number) => `Publication dans ${seconds} s` },
} as const;

/**
 * "Publish now" with the workspace's undo-send window: nothing is sent while the
 * countdown runs, and Undo (or leaving the page) cancels it. A window of 0
 * submits straight away.
 */
export function PublishNowButton({ postId, undoSendSeconds, disabled = false }: { postId: string; undoSendSeconds: number; disabled?: boolean }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copy, setCopy] = useState<(typeof publishNowCopy)[keyof typeof publishNowCopy]>(publishNowCopy.en);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { setCopy((document.documentElement.lang || navigator.language).toLowerCase().startsWith("fr") ? publishNowCopy.fr : publishNowCopy.en); }, []);
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
