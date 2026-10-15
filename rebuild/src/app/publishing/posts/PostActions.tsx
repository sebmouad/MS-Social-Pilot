"use client";

import { useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/Button";
import { ModalDialog } from "@/components/ModalDialog";
import { cancelScheduledPostAction, deletePostAction, publishPostAction, submitForApprovalAction, syncPostAction } from "./actions";
import styles from "../publishing.module.css";

export type RowActionFlags = {
  id: string;
  /** Short text so dialogs can name the post. */
  excerpt: string;
  editable: boolean;
  canPublishNow: boolean;
  canSubmit: boolean;
  canCancel: boolean;
  canSync: boolean;
  canDelete: boolean;
  canDeleteRemote: boolean;
  /** Channels that will receive the post when it is published. */
  channelNames: string[];
  /** Live copies of the post: channel and platform names. */
  remote: Array<{ channel: string; platform: string }>;
};

function Submit({ children, variant = "secondary", size = "sm" }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "quiet"; size?: "sm" | "md" }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending || undefined}>{pending ? "Working…" : children}</Button>;
}

function PostForm({ action, id, children }: { action: (data: FormData) => void | Promise<void>; id: string; children: ReactNode }) {
  return <form action={action}><input type="hidden" name="postId" value={id} />{children}</form>;
}

export function PostRowActions({ post, mode = "full" }: { post: RowActionFlags; mode?: "full" | "queue" }) {
  const [dialog, setDialog] = useState<"publish" | "delete" | null>(null);
  const titleId = useId();
  const platforms = [...new Set(post.remote.map(item => item.platform))];
  const hasRemote = post.remote.length > 0;
  const close = () => setDialog(null);
  return <div className={styles.rowActions}>
    {mode === "full" && post.editable ? <a className="ui-button ui-button--secondary ui-button--sm" href={`/publishing/compose?edit=${encodeURIComponent(post.id)}`}>Edit draft</a> : null}
    {mode === "full" && post.canPublishNow ? <Button size="sm" variant="primary" onClick={() => setDialog("publish")}>Publish now</Button> : null}
    {mode === "full" && post.canSubmit ? <PostForm action={submitForApprovalAction} id={post.id}><Submit>Submit for approval</Submit></PostForm> : null}
    {post.canCancel ? <PostForm action={cancelScheduledPostAction} id={post.id}><Submit>Cancel schedule</Submit></PostForm> : null}
    {mode === "full" && post.canSync ? <PostForm action={syncPostAction} id={post.id}><Submit>Sync status</Submit></PostForm> : null}
    {mode === "full" && post.canDelete ? <Button size="sm" variant="quiet" className={styles.deleteTrigger} onClick={() => setDialog("delete")} aria-label={`Delete post: ${post.excerpt}`}>Delete…</Button> : null}

    {dialog === "publish" ? <ModalDialog className="ui-dialog" labelledBy={`${titleId}-publish`} onDismiss={close}>
      <PostForm action={publishPostAction} id={post.id}>
        <div className="ui-dialog__header"><div><h2 id={`${titleId}-publish`}>Publish this post now?</h2><p>It goes live right away on {post.channelNames.join(", ")}.</p></div></div>
        <div className="ui-dialog__body"><p className={styles.dialogQuote}>{post.excerpt}</p></div>
        <div className="ui-dialog__actions"><Button type="button" data-dialog-cancel onClick={close}>Cancel</Button><Submit variant="primary" size="md">Publish now</Submit></div>
      </PostForm>
    </ModalDialog> : null}

    {dialog === "delete" ? <ModalDialog className="ui-dialog" labelledBy={`${titleId}-delete`} onDismiss={close}>
      <PostForm action={deletePostAction} id={post.id}>
        <div className="ui-dialog__header"><div><h2 id={`${titleId}-delete`}>Delete this post?</h2><p>This cannot be undone.</p></div></div>
        <div className="ui-dialog__body">
          <p className={styles.dialogQuote}>{post.excerpt}</p>
          {hasRemote ? <fieldset className={styles.deleteChoices}>
            <legend>This post is live on {platforms.join(" and ")}. What should be deleted?</legend>
            <label><input type="radio" name="deleteRemote" value="" defaultChecked /><span><strong>Delete in Social Pilot only</strong><small>The post and its history are removed here. It stays live on {platforms.join(" and ")}.</small></span></label>
            {post.canDeleteRemote ? <label><input type="radio" name="deleteRemote" value="on" /><span><strong>Delete here and on {platforms.join(" and ")}</strong><small>It is removed from {post.remote.map(item => `${item.channel} (${item.platform})`).join(", ")}, then here. If a platform cannot confirm, nothing is deleted.</small></span></label> : <p className={styles.help}>Only workspace owners, admins, and editors can also delete the live post.</p>}
          </fieldset> : <p>This removes the post and its history from Social Pilot. It was never published, so nothing changes on any platform.</p>}
        </div>
        <div className="ui-dialog__actions"><Button type="button" data-dialog-cancel onClick={close}>Keep post</Button><Submit variant="danger" size="md">Delete post</Submit></div>
      </PostForm>
    </ModalDialog> : null}
  </div>;
}
