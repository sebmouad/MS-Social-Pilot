"use client";

import { cancelScheduledPostAction, createPostAction, deletePostAction, importPostsAction, publishPostAction, schedulePostAction, submitForApprovalAction, syncPostAction, updatePostAction } from "./actions";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components";
import { ModalDialog } from "@/components/ModalDialog";
import styles from "../publishing.module.css";
import { csvDestinationLabel } from '@/lib/publishing/csv-destinations';
import { validateFields } from '@/lib/ui/form-validation';

type TargetChoice = { id: string; name: string; type: string; provider: string | null; canPublish: boolean };
type ImageRules = { allowedMimeTypes: string[]; maxUploadBytes: number; maxAltCharacters: number };
type PostRow = { id: string; message: string; firstComment: string | null; link: string | null; media: Array<{kind: string; url: string; altText?: string}>; status: string; publishedAt: Date | null; targets: Array<{ status: string; remotePostId: string | null; target: { id: string } }> };

function validatePostForm(form: HTMLFormElement) {
  const errors = validateFields(form, {
    message: { empty: 'Write the post text before saving.' },
    link: { invalid: 'Enter a complete link, such as https://example.com.' },
    imageUrl: { invalid: 'Enter a complete image URL.' },
    videoUrl: { invalid: 'Enter a complete video URL.' },
  });
  const attachmentFields = ['link', 'imageUrl', 'videoUrl'];
  const selected = attachmentFields.filter(name => (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim());
  const imageFile = form.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0];
  if (imageFile) selected.push('imageFile');
  if (selected.length > 1) {
    errors.attachment = 'Choose one attachment: a link, image, or video. Clear the others before saving.';
    if (Object.keys(errors).length === 1) {
      const conflict = selected[1] === 'imageFile' ? form.querySelector<HTMLInputElement>('input[type="file"]') : form.elements.namedItem(selected[1]);
      if (conflict instanceof HTMLElement) conflict.focus();
    }
  }
  return errors;
}

function submitPost(event: FormEvent<HTMLFormElement>, setErrors: (errors: Record<string, string>) => void) {
  const errors = validatePostForm(event.currentTarget);
  setErrors(errors);
  if (Object.keys(errors).length) { event.preventDefault(); return; }
  uploadImageBeforeSubmit(event);
}

function uploadImageBeforeSubmit(event: FormEvent<HTMLFormElement>) {
  const form = event.currentTarget;
  const input = form.querySelector<HTMLInputElement>('input[type="file"]');
  const file = input?.files?.[0];
  if (!input || !file) return;
  event.preventDefault();
  if (form.dataset.uploading === 'true') return;
  const value = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value.trim() ?? '';
  const output = form.querySelector<HTMLElement>('[data-image-upload-status]');
  if (value('imageUrl') || value('videoUrl') || value('link')) {
    if (output) output.textContent = 'Choose a link, an image, or a video. Clear the other attachment fields before uploading.';
    return;
  }
  form.dataset.uploading = 'true';
  if (output) output.textContent = 'Uploading image…';
  const body = new FormData();
  body.append('imageFile', file);
  const submitter = (event.nativeEvent as SubmitEvent).submitter;
  fetch('/api/media', { method: 'POST', body })
    .then(async response => {
      const result = await response.json().catch(() => ({})) as { reference?: string; error?: string };
      if (!response.ok || !result.reference) throw new Error(result.error || 'Image upload failed. Please try again.');
      const reference = form.querySelector<HTMLInputElement>('input[name="uploadedImageRef"]');
      if (!reference) throw new Error('The upload could not be attached to this post.');
      reference.value = result.reference;
      input.value = '';
      form.dataset.uploading = 'false';
      if (output) output.textContent = '';
      form.requestSubmit(submitter instanceof HTMLElement ? submitter : undefined);
    })
    .catch(error => {
      form.dataset.uploading = 'false';
      if (output) output.textContent = error instanceof Error ? error.message : 'Image upload failed. Please try again.';
    });
}

function ImageAttachment({ post, imageRules }: { post?: PostRow; imageRules: ImageRules }) {
  const image = post?.media.find(item => item.kind === 'image');
  const existingReference = image?.url.startsWith('media:') ? image.url : '';
  const existingId = existingReference.slice('media:'.length);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState('');
  const [removeExisting, setRemoveExisting] = useState(false);
  useEffect(() => {
    if (!file) { setFilePreview(''); return; }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const preview = filePreview || (existingId ? `/api/media/${encodeURIComponent(existingId)}` : image?.url || '');
  return <div className={styles.imageAttachment}>
    <label htmlFor={post ? `image-file-${post.id}` : 'new-post-image'}>Image <span>(optional)</span></label>
    <input id={post ? `image-file-${post.id}` : 'new-post-image'} type="file" accept={imageRules.allowedMimeTypes.join(',')} onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setRemoveExisting(false); const form = event.currentTarget.form; const uploadedRef = form?.querySelector<HTMLInputElement>('input[name="uploadedImageRef"]'); if (uploadedRef) uploadedRef.value = ''; }} />
    {existingReference ? <input type="hidden" name="existingImageRef" value={existingReference} /> : null}
    <input type="hidden" name="uploadedImageRef" value="" />
    {existingReference ? <label className={styles.removeImage}><input type="checkbox" name="removeExistingImage" checked={removeExisting} onChange={event => setRemoveExisting(event.currentTarget.checked)} /> Remove current image</label> : null}
    <label htmlFor={post ? `image-alt-${post.id}` : 'new-post-image-alt'}>Image description <span>(optional)</span></label>
    <input id={post ? `image-alt-${post.id}` : 'new-post-image-alt'} name="altText" type="text" maxLength={imageRules.maxAltCharacters} placeholder="Describe the image for people using a screen reader" defaultValue={image?.altText ?? ''} />
    {preview && (!removeExisting || file) ? <div className={styles.imagePreview}><img src={preview} alt="Selected post image preview" width={72} height={72} /><span>{file ? file.name : 'Current image'}</span></div> : null}
    <small aria-live="polite" data-image-upload-status="true" />
    <small>Upload one image up to {Math.ceil(imageRules.maxUploadBytes / 1048576)} MB. Destinations may have lower limits.</small>
  </div>;
}

function AttachmentFields({ post, imageRules, errors = {} }: { post?: PostRow; imageRules: ImageRules; errors?: Record<string, string> }) {
  const prefix = post?.id ?? 'new-post';
  return <>
    <label htmlFor={`${prefix}-link`}>Link <span>(optional)</span></label><input id={`${prefix}-link`} name="link" type="url" placeholder="https://example.com" defaultValue={post?.link ?? ''} aria-invalid={Boolean(errors.link)} aria-describedby={errors.link ? `${prefix}-link-error` : undefined} />{errors.link && <small id={`${prefix}-link-error`} className={styles.formError}>{errors.link}</small>}
    <ImageAttachment post={post} imageRules={imageRules} />
    <label htmlFor={`${prefix}-image-url`}>Image URL <span>(optional)</span></label><input id={`${prefix}-image-url`} name="imageUrl" type="url" placeholder="https://example.com/image.jpg" defaultValue={post?.media.find(item => item.kind === 'image' && !item.url.startsWith('media:'))?.url ?? ''} aria-invalid={Boolean(errors.imageUrl)} aria-describedby={errors.imageUrl ? `${prefix}-image-url-error` : undefined} />{errors.imageUrl && <small id={`${prefix}-image-url-error`} className={styles.formError}>{errors.imageUrl}</small>}
    <label htmlFor={`${prefix}-video-url`}>Video URL <span>(optional)</span></label><input id={`${prefix}-video-url`} name="videoUrl" type="url" placeholder="https://example.com/video.mp4" defaultValue={post?.media.find(item => item.kind === 'video')?.url ?? ''} aria-invalid={Boolean(errors.videoUrl)} aria-describedby={errors.videoUrl ? `${prefix}-video-url-error` : undefined} />{errors.videoUrl && <small id={`${prefix}-video-url-error`} className={styles.formError}>{errors.videoUrl}</small>}
    <small>Choose a link, one uploaded image or image URL, or a video URL. Provider support varies by destination.</small>
    {errors.attachment && <p role="alert" className={styles.formError}>{errors.attachment}</p>}
  </>;
}

export function PostEditorForm({ targets, imageRules, schedule }: { targets: TargetChoice[]; imageRules: ImageRules; schedule?: { date: string; time: string; timeZone: string } }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  return <form action={createPostAction} noValidate className={styles.draftForm} onSubmit={event => submitPost(event, setErrors)}>
    <label htmlFor="new-post-message">Post text</label>
    <textarea id="new-post-message" name="message" required rows={4} placeholder="Write a post for your team…" aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'new-post-message-error' : undefined} />
    {errors.message && <p id="new-post-message-error" className={styles.formError}>{errors.message}</p>}
    <label htmlFor="new-post-first-comment">First comment <span>(optional)</span></label>
    <textarea id="new-post-first-comment" name="firstComment" rows={2} placeholder="Add a link or follow-up as the first comment…" />
    <AttachmentFields imageRules={imageRules} errors={errors} />
    <TargetPicker targets={targets} />
    {schedule && <fieldset className={styles.targetPicker}><legend>Publishing time</legend><p>Times use {schedule.timeZone.replaceAll('_', ' ')}.</p><label>Date<input type="date" name="scheduleDate" defaultValue={schedule.date} required /></label><label>Time<input type="time" name="scheduleTime" defaultValue={schedule.time} required /></label></fieldset>}
    <div className={styles.formFooter}><span>{schedule ? 'Save a draft or add it to the queue.' : 'Saved locally until you publish it.'}</span>{schedule && <button className="ui-button ui-button--secondary" type="submit" name="intent" value="draft">Save draft</button>}<button className="ui-button ui-button--primary" type="submit" name="intent" value={schedule ? 'schedule' : 'draft'}>{schedule ? 'Add to queue' : 'Create post'}</button></div>
  </form>;
}

export function CsvImportForm({ targets }: { targets: TargetChoice[] }) {
  const [error, setError] = useState('');
  return <form action={importPostsAction} noValidate className={styles.draftForm} onSubmit={event => {
    const input = event.currentTarget.elements.namedItem('csv');
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]?.size) {
      event.preventDefault(); setError('Choose a non-empty CSV file to import.'); input instanceof HTMLInputElement && input.focus();
    } else setError('');
  }}>
    <label htmlFor="posts-csv">Import posts from CSV</label>
    <p className={styles.help}>Required header: <code>message,firstComment,channels</code>. Use the channel labels below; separate multiple channels with semicolons. Leave channels empty to import a local draft. Imported posts remain drafts.</p>
    <ul className={styles.targetReference}>{targets.filter(target => target.canPublish).map(target => <li key={target.id}>{csvDestinationLabel(target)}</li>)}</ul>
    <input id="posts-csv" type="file" name="csv" accept=".csv,text/csv" required aria-invalid={Boolean(error)} aria-describedby={error ? 'posts-csv-error' : undefined} />
    {error && <p id="posts-csv-error" className={styles.formError}>{error}</p>}
    <button className="ui-button ui-button--secondary" type="submit">Import CSV</button>
  </form>;
}

export function PostRowActions({ post, targets, canEdit, canPublish, imageRules }: { post: PostRow; targets: TargetChoice[]; canEdit: boolean; canPublish: boolean; imageRules: ImageRules }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const selected = new Set(post.targets.map(item => item.target.id));
  const hasRemote = post.targets.some(item => Boolean(item.remotePostId));
  const isDraft = post.status === 'draft' && !post.publishedAt;
  const isQueued = post.status === 'scheduled';
  return <div className={styles.rowActions}>
    {canEdit && isDraft && post.media.length <= 1 ? <details className={styles.editDetails}>
      <summary>Edit post</summary>
      <form action={updatePostAction} noValidate className={styles.editForm} onSubmit={event => submitPost(event, setEditErrors)}>
        <input type="hidden" name="postId" value={post.id} />
        <label htmlFor={`message-${post.id}`}>Post text</label>
        <textarea id={`message-${post.id}`} name="message" defaultValue={post.message} required rows={4} aria-invalid={Boolean(editErrors.message)} aria-describedby={editErrors.message ? `message-error-${post.id}` : undefined} />
        {editErrors.message && <p id={`message-error-${post.id}`} className={styles.formError}>{editErrors.message}</p>}
        <label htmlFor={`comment-${post.id}`}>First comment <span>(optional)</span></label>
        <textarea id={`comment-${post.id}`} name="firstComment" defaultValue={post.firstComment ?? ''} rows={2} />
        <AttachmentFields post={post} imageRules={imageRules} errors={editErrors} />
        <TargetPicker targets={targets} selected={selected} />
        <button className="ui-button ui-button--secondary ui-button--sm" type="submit">Save post</button>
      </form>
    </details> : null}
    {canEdit && isDraft && post.media.length > 1 ? <span className={styles.noActions}>Posts with multiple media attachments need the full media editor before changes can be made.</span> : null}
    {canPublish && isDraft && post.targets.length ? <form action={publishPostAction}>
      <input type="hidden" name="postId" value={post.id} />
      <button className="ui-button ui-button--primary ui-button--sm" type="submit">Publish now</button>
    </form> : null}
    {canEdit && isDraft && post.targets.length ? <>
      <form action={submitForApprovalAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Submit for approval</button></form>
      <ScheduleForm postId={post.id}/>
    </> : null}
    {canEdit && isQueued ? <form action={cancelScheduledPostAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Cancel schedule</button></form> : null}
    {hasRemote ? <form action={syncPostAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Sync status</button></form> : null}
    {post.targets.some(item => item.status === 'processing' && !item.remotePostId) ? <span className={styles.noActions}>A publish result needs review on the destination before retrying.</span> : null}
    <Button variant="danger" size="sm" type="button" onClick={() => setDeleteOpen(true)}>Delete locally</Button>
    {deleteOpen && <ModalDialog className="ui-dialog" labelledBy={`delete-title-${post.id}`} onDismiss={() => setDeleteOpen(false)}>
      <form action={deletePostAction}>
        <input type="hidden" name="postId" value={post.id} />
        <div className="ui-dialog__header"><div><h2 id={`delete-title-${post.id}`}>Delete this post locally?</h2><p>This permanently removes the post and its local publishing history.</p></div></div>
        <div className="ui-dialog__body">
          <p>{hasRemote ? 'Remote posts will remain on their platforms unless you also select remote deletion.' : 'No remote post is recorded for this item.'}</p>
          {hasRemote ? <label className={styles.confirmCheck}><input type="checkbox" name="deleteRemote" /> Also delete recorded remote posts. This cannot be undone.</label> : null}
        </div>
        <div className="ui-dialog__actions"><Button type="button" data-dialog-cancel onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" type="submit">Delete locally</Button></div>
      </form>
    </ModalDialog>}
  </div>;
}

function ScheduleForm({ postId }: { postId: string }) {
  return <form action={schedulePostAction} className={styles.scheduleForm} onSubmit={event => {
    const form = event.currentTarget;
    const input = form.elements.namedItem('localScheduledAt');
    const hidden = form.elements.namedItem('scheduledAt');
    if (input instanceof HTMLInputElement && hidden instanceof HTMLInputElement && input.value) {
      const date = new Date(input.value);
      if (Number.isFinite(date.getTime())) hidden.value = date.toISOString();
    }
  }}>
    <input type="hidden" name="postId" value={postId}/>
    <label>Schedule (your local time) <input type="datetime-local" name="localScheduledAt" required/></label>
    <input type="hidden" name="scheduledAt"/>
    <button className="ui-button ui-button--secondary ui-button--sm" type="submit">Add to queue</button>
  </form>;
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
