"use client";

import { createPostAction, deletePostAction, importPostsAction, publishPostAction, syncPostAction, updatePostAction } from "./actions";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components";
import styles from "../publishing.module.css";

type TargetChoice = { id: string; name: string; type: string; provider: string | null; canPublish: boolean };
type PostRow = { id: string; message: string; firstComment: string | null; status: string; publishedAt: Date | null; targets: Array<{ status: string; remotePostId: string | null; target: { id: string } }> };

export function PostEditorForm({ targets }: { targets: TargetChoice[] }) {
  return <form action={createPostAction} className={styles.draftForm}>
    <label htmlFor="new-post-message">Post text</label>
    <textarea id="new-post-message" name="message" required rows={4} placeholder="Write a post for your team…" />
    <label htmlFor="new-post-first-comment">First comment <span>(optional)</span></label>
    <textarea id="new-post-first-comment" name="firstComment" rows={2} placeholder="Add a link or follow-up as the first comment…" />
    <TargetPicker targets={targets} />
    <div className={styles.formFooter}><span>Saved locally until you publish it.</span><button className="ui-button ui-button--primary" type="submit">Create post</button></div>
  </form>;
}

export function CsvImportForm({ targets }: { targets: TargetChoice[] }) {
  return <form action={importPostsAction} className={styles.draftForm}>
    <label htmlFor="posts-csv">Import posts from CSV</label>
    <p className={styles.help}>Required header: <code>message,firstComment,targetIds</code>. Separate multiple target IDs with semicolons. Imported posts remain drafts.</p>
    <ul className={styles.targetReference}>{targets.filter(target => target.canPublish).map(target => <li key={target.id}>{target.name}: <code>{target.id}</code></li>)}</ul>
    <input id="posts-csv" type="file" name="csv" accept=".csv,text/csv" required />
    <button className="ui-button ui-button--secondary" type="submit">Import CSV</button>
  </form>;
}

export function PostRowActions({ post, targets, canEdit, canPublish }: { post: PostRow; targets: TargetChoice[]; canEdit: boolean; canPublish: boolean }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = new Set(post.targets.map(item => item.target.id));
  const hasRemote = post.targets.some(item => Boolean(item.remotePostId));
  const isDraft = post.status === 'draft' && !post.publishedAt;
  useEffect(() => {
    if (deleteOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!deleteOpen && dialog.current?.open) dialog.current.close();
  }, [deleteOpen]);
  return <div className={styles.rowActions}>
    {canEdit && isDraft ? <details className={styles.editDetails}>
      <summary>Edit post</summary>
      <form action={updatePostAction} className={styles.editForm}>
        <input type="hidden" name="postId" value={post.id} />
        <label htmlFor={`message-${post.id}`}>Post text</label>
        <textarea id={`message-${post.id}`} name="message" defaultValue={post.message} required rows={4} />
        <label htmlFor={`comment-${post.id}`}>First comment <span>(optional)</span></label>
        <textarea id={`comment-${post.id}`} name="firstComment" defaultValue={post.firstComment ?? ''} rows={2} />
        <TargetPicker targets={targets} selected={selected} />
        <button className="ui-button ui-button--secondary ui-button--sm" type="submit">Save post</button>
      </form>
    </details> : null}
    {canPublish && isDraft && post.targets.length ? <form action={publishPostAction}>
      <input type="hidden" name="postId" value={post.id} />
      <button className="ui-button ui-button--primary ui-button--sm" type="submit">Publish now</button>
    </form> : null}
    {hasRemote ? <form action={syncPostAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Sync status</button></form> : null}
    {post.targets.some(item => item.status === 'processing' && !item.remotePostId) ? <span className={styles.noActions}>A publish result needs review on the destination before retrying.</span> : null}
    <Button variant="danger" size="sm" type="button" onClick={() => setDeleteOpen(true)}>Delete locally</Button>
    <dialog className="ui-dialog" aria-labelledby={`delete-title-${post.id}`} ref={dialog} onClose={() => setDeleteOpen(false)} onCancel={event => { event.preventDefault(); setDeleteOpen(false); }}>
      <form action={deletePostAction}>
        <input type="hidden" name="postId" value={post.id} />
        <div className="ui-dialog__header"><div><h2 id={`delete-title-${post.id}`}>Delete this post locally?</h2><p>This permanently removes the post and its local publishing history.</p></div></div>
        <div className="ui-dialog__body">
          <p>{hasRemote ? 'Remote posts will remain on their platforms unless you also select remote deletion.' : 'No remote post is recorded for this item.'}</p>
          {hasRemote ? <label className={styles.confirmCheck}><input type="checkbox" name="deleteRemote" /> Also delete recorded remote posts. This cannot be undone.</label> : null}
        </div>
        <div className="ui-dialog__actions"><Button type="button" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" type="submit">Delete locally</Button></div>
      </form>
    </dialog>
  </div>;
}

function TargetPicker({ targets, selected = new Set<string>() }: { targets: TargetChoice[]; selected?: Set<string> }) {
  const supported = targets.filter(target => target.canPublish);
  return <fieldset className={styles.targetPicker}>
    <legend>Destinations <span>(optional)</span></legend>
    {supported.length ? supported.map(target => <label key={target.id}>
      <input type="checkbox" name="targetIds" value={target.id} defaultChecked={selected.has(target.id)} />
      <span>{target.name}</span>
    </label>) : <p>No enabled destinations can publish right now.</p>}
    <small>Only enabled destinations that support publishing are shown.</small>
  </fieldset>;
}
