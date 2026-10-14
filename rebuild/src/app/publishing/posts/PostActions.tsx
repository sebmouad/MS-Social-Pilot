"use client";

import { createDraftAction, deleteDraftAction, updateDraftAction } from "./actions";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components";
import styles from "../publishing.module.css";

export function CreateDraftForm() {
  return <form action={createDraftAction} className={styles.draftForm}>
    <label htmlFor="new-post-message">Post text</label>
    <textarea id="new-post-message" name="message" maxLength={10_000} required rows={4} placeholder="Write a draft for your team…" />
    <div className={styles.formFooter}><span>Saved as a local draft. No channels are selected.</span><button className="ui-button ui-button--primary" type="submit">Create draft</button></div>
  </form>;
}

export function DraftRowActions({ postId, message }: { postId: string; message: string }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteForm = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleteOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!deleteOpen && dialog.current?.open) dialog.current.close();
  }, [deleteOpen]);
  return <div className={styles.rowActions}>
    <details className={styles.editDetails}>
      <summary>Edit draft</summary>
      <form action={updateDraftAction} className={styles.editForm}>
        <input type="hidden" name="postId" value={postId} />
        <label htmlFor={`message-${postId}`}>Post text</label>
        <textarea id={`message-${postId}`} name="message" defaultValue={message} maxLength={10_000} required rows={4} />
        <button className="ui-button ui-button--secondary ui-button--sm" type="submit">Save draft</button>
      </form>
    </details>
    <form ref={deleteForm} action={deleteDraftAction} className={styles.hiddenForm}>
      <input type="hidden" name="postId" value={postId} />
    </form>
    <Button variant="danger" size="sm" type="button" onClick={() => setDeleteOpen(true)}>Delete draft</Button>
    <dialog
      className="ui-dialog"
      aria-labelledby={`delete-title-${postId}`}
      aria-describedby={`delete-description-${postId}`}
      ref={dialog}
      onClose={() => setDeleteOpen(false)}
      onCancel={event => { event.preventDefault(); setDeleteOpen(false); }}
    >
      <div className="ui-dialog__header"><div><h2 id={`delete-title-${postId}`}>Delete this draft?</h2><p id={`delete-description-${postId}`}>This permanently removes the unpublished draft and its associated local notes and history. No social channel will be contacted.</p></div></div>
      <div className="ui-dialog__body"><p>This action cannot be undone.</p></div>
      <div className="ui-dialog__actions"><Button type="button" onClick={() => setDeleteOpen(false)}>Keep draft</Button><Button variant="danger" type="button" onClick={() => deleteForm.current?.requestSubmit()}>Delete draft</Button></div>
    </dialog>
  </div>;
}
