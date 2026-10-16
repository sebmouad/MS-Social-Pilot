'use client';

import { useActionState, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { PostPreview } from '@/components/PostPreview';
import { SidebarDock } from '@/components/SidebarDock';
import { createPostWithRecoveryAction, type ComposerActionState } from '../posts/actions';
import styles from './PostComposer.module.css';

type TargetChoice = { id: string; name: string; type: string; provider: string | null; canPublish: boolean };
type ImageRules = { allowedMimeTypes: string[]; maxUploadBytes: number; maxAltCharacters: number; maxMessageCharacters: number };
type Schedule = { date: string; time: string; timeZone: string };
type AttachmentKind = 'none' | 'link' | 'upload' | 'imageUrl' | 'videoUrl';

const INITIAL_STATE: ComposerActionState = { status: 'idle', values: {} };
const FORM_ID = 'post-composer-form';

async function saveWithTransportRecovery(previous: ComposerActionState, data: FormData): Promise<ComposerActionState> {
  try { return await createPostWithRecoveryAction(previous, data); }
  catch (error) {
    // Next redirects are framework control flow and must reach its action router.
    if (error && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) throw error;
    return { status: 'error', saveUnconfirmed: true, message: 'We could not confirm whether this post was saved. Check Posts before retrying.', values: previous.values };
  }
}

export function PostComposer({ targets, imageRules, schedule, authorName, createdAt, createdAtDisplay }: { targets: TargetChoice[]; imageRules: ImageRules; schedule: Schedule; authorName: string; createdAt: Date; createdAtDisplay: string }) {
  const [state, formAction, pending] = useActionState(saveWithTransportRecovery, INITIAL_STATE);
  const initial = state.values;
  const [message, setMessage] = useState(initial.message ?? '');
  const [firstComment, setFirstComment] = useState(initial.firstComment ?? '');
  const [link, setLink] = useState(initial.link ?? '');
  const [imageUrl, setImageUrl] = useState(initial.imageUrl ?? '');
  const [videoUrl, setVideoUrl] = useState(initial.videoUrl ?? '');
  const [uploadedImageRef, setUploadedImageRef] = useState(initial.uploadedImageRef ?? '');
  const [altText, setAltText] = useState(initial.altText ?? '');
  const [attachmentKind, setAttachmentKind] = useState<AttachmentKind>((initial.attachmentKind as AttachmentKind) ?? 'none');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(initial.targetIds ?? []);
  const [scheduleDate, setScheduleDate] = useState(initial.scheduleDate ?? schedule.date);
  const [scheduleTime, setScheduleTime] = useState(initial.scheduleTime ?? schedule.time);
  const [mode, setMode] = useState<'draft' | 'schedule'>((initial.intent as 'draft' | 'schedule') ?? 'draft');
  const [localError, setLocalError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const submitGuard = useRef<'ready' | 'uploading' | 'submitting'>('ready');
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRefInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === 'error') {
      submitGuard.current = 'ready';
      setLocalError('');
    }
  }, [state]);
  useEffect(() => {
    if (!file) { setFilePreview(''); return; }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const selected = useMemo(() => targets.filter(target => selectedTargets.includes(target.id) && target.canPublish), [targets, selectedTargets]);
  const previewPost = useMemo(() => ({
    id: 'composer-preview', authorId: 'preview', message, firstComment: firstComment || null,
    link: attachmentKind === 'link' ? link : null,
    media: attachmentKind === 'upload' && filePreview
      ? []
      : attachmentKind === 'upload' && uploadedImageRef
        ? [{ kind: 'image', url: uploadedImageRef, altText }]
        : attachmentKind === 'imageUrl' && imageUrl
          ? [{ kind: 'image', url: imageUrl, altText }]
          : attachmentKind === 'videoUrl' && videoUrl ? [{ kind: 'video', url: videoUrl }] : [],
    status: 'draft', scheduledAt: null, publishedAt: null, createdAt, displayTime: createdAtDisplay,
    targets: selected.map(target => ({ status: 'pending', remotePostId: null, remoteUrl: null, target: { id: target.id, type: target.type, name: target.name, pictureUrl: null } })),
  }), [message, firstComment, attachmentKind, link, filePreview, uploadedImageRef, altText, imageUrl, videoUrl, createdAt, createdAtDisplay, selected]);

  function setAttachment(kind: AttachmentKind) {
    setAttachmentKind(kind);
    setUploadMessage('');
    if (kind !== 'upload') {
      setFile(null);
      setUploadedImageRef('');
      if (uploadRefInput.current) uploadRefInput.current.value = '';
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === 'schedule' ? 'schedule' : 'draft';
    const selectedFile = fileInput.current?.files?.[0] ?? null;
    const attachedUpload = uploadRefInput.current?.value || uploadedImageRef;
    setMode(intent);
    setLocalError('');
    setUploadMessage('');
    if (!message.trim()) {
      event.preventDefault(); setLocalError('Write the post text before saving.'); form.elements.namedItem('message') instanceof HTMLElement && (form.elements.namedItem('message') as HTMLElement).focus(); return;
    }
    if (message.length > imageRules.maxMessageCharacters) {
      event.preventDefault(); setLocalError(`Post text must be ${imageRules.maxMessageCharacters.toLocaleString()} characters or fewer.`); return;
    }
    const activeUrl = attachmentKind === 'link' ? link : attachmentKind === 'imageUrl' ? imageUrl : attachmentKind === 'videoUrl' ? videoUrl : '';
    if (activeUrl) {
      let valid = false;
      try { const parsed = new URL(activeUrl); valid = parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { /* handled as field validation */ }
      if (!valid) {
        event.preventDefault(); setLocalError('Enter a complete HTTPS URL without a username or password.');
        const fieldId = attachmentKind === 'link' ? 'composer-link' : attachmentKind === 'imageUrl' ? 'composer-image-url' : 'composer-video-url';
        document.getElementById(fieldId)?.focus(); return;
      }
    }
    if (intent === 'schedule' && (!scheduleDate || !scheduleTime || !selected.length)) {
      event.preventDefault(); setLocalError(!selected.length ? 'Choose at least one destination before scheduling.' : 'Choose a date and time before scheduling.'); return;
    }
    if (attachmentKind === 'upload' && !selectedFile && !attachedUpload) {
      event.preventDefault(); setLocalError('Choose an image file to upload.'); fileInput.current?.focus(); return;
    }
    if (attachmentKind === 'upload' && selectedFile) {
      event.preventDefault();
      if (submitGuard.current !== 'ready') return;
      if (!imageRules.allowedMimeTypes.includes(selectedFile.type) || selectedFile.size > imageRules.maxUploadBytes) {
        setLocalError(`Choose an allowed image up to ${Math.ceil(imageRules.maxUploadBytes / 1048576)} MB.`); return;
      }
      submitGuard.current = 'uploading';
      setUploading(true);
      setUploadMessage('Uploading image…');
      try {
        const body = new FormData(); body.append('imageFile', selectedFile);
        const response = await fetch('/api/media', { method: 'POST', body });
        const result = await response.json().catch(() => ({})) as { reference?: string };
        if (!response.ok || !result.reference) throw new Error('upload');
        submitGuard.current = 'ready';
        flushSync(() => {
          setUploadedImageRef(result.reference!);
          if (uploadRefInput.current) uploadRefInput.current.value = result.reference!;
          setFile(null);
          if (fileInput.current) fileInput.current.value = '';
          setUploadMessage('');
          setUploading(false);
        });
        form.requestSubmit(submitter ?? undefined);
      } catch {
        setUploading(false);
        submitGuard.current = 'ready';
        setUploadMessage('We could not upload that image. Your post details are still here; try again.');
      }
      return;
    }
    if (submitGuard.current !== 'ready') { event.preventDefault(); return; }
    submitGuard.current = 'submitting';
  }

  return <div className={styles.composerLayout}>
    <form id={FORM_ID} action={formAction} onSubmit={onSubmit} className={styles.form} noValidate>
      <input type="hidden" name="attachmentKind" value={attachmentKind} />
      {localError && <p className={styles.error} role="alert">{localError}</p>}
      {state.status === 'error' && <p className={styles.error} role="alert">{state.message} Your post details are still here.{state.saveUnconfirmed ? <> <a href="/publishing/posts" target="_blank" rel="noopener noreferrer">Check Posts in a new tab</a>.</> : ' You can retry.'}</p>}
      {uploadMessage && <p className={styles.uploadNotice} role="status">{uploadMessage}</p>}
      <label htmlFor="composer-message">Post text</label>
      <textarea id="composer-message" name="message" value={message} onChange={event => setMessage(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={7} placeholder="Write a post for your team…" aria-describedby="composer-message-count" />
      <div className={styles.fieldMeta} id="composer-message-count">{message.length.toLocaleString()} / {imageRules.maxMessageCharacters.toLocaleString()}</div>
      <label htmlFor="composer-first-comment">First comment <span>(optional)</span></label>
      <textarea id="composer-first-comment" name="firstComment" value={firstComment} onChange={event => setFirstComment(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={3} placeholder="Add a link or follow-up as the first comment…" />

      <fieldset className={styles.attachments}>
        <legend>Attachment <span>(optional, choose one)</span></legend>
        <div className={styles.attachmentChoices} role="group" aria-label="Choose attachment type">
          {([['none', 'None'], ['link', 'Link'], ['upload', 'Upload image'], ['imageUrl', 'Image URL'], ['videoUrl', 'Video URL']] as const).map(([value, label]) => <label key={value}>
            <input type="radio" name="attachmentChoice" value={value} checked={attachmentKind === value} disabled={uploading || pending} onChange={() => setAttachment(value)} />{label}
          </label>)}
        </div>
        {attachmentKind === 'link' && <div className={styles.attachmentField}><label htmlFor="composer-link">Link URL</label><input id="composer-link" name="link" type="url" value={link} onChange={event => setLink(event.currentTarget.value)} placeholder="https://example.com" /></div>}
        {attachmentKind === 'upload' && <div className={styles.attachmentField}>
          <label htmlFor="composer-upload">Image file</label><input ref={fileInput} id="composer-upload" type="file" accept={imageRules.allowedMimeTypes.join(',')} disabled={uploading || pending} onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setUploadedImageRef(''); if (uploadRefInput.current) uploadRefInput.current.value = ''; }} />
          <input ref={uploadRefInput} type="hidden" name="uploadedImageRef" value={uploadedImageRef} readOnly />
          {(filePreview || uploadedImageRef) && <div className={styles.localThumbnail}><img src={filePreview || `/api/media/${encodeURIComponent(uploadedImageRef.slice('media:'.length))}`} alt="Selected image preview" /><span>{file?.name ?? 'Uploaded image'}</span></div>}
          <label htmlFor="composer-upload-alt">Image description <span>(optional)</span></label><input id="composer-upload-alt" name="altText" type="text" maxLength={imageRules.maxAltCharacters} value={altText} onChange={event => setAltText(event.currentTarget.value)} />
          <small>Up to {Math.ceil(imageRules.maxUploadBytes / 1048576)} MB. Destinations may have lower limits.</small>
        </div>}
        {attachmentKind === 'imageUrl' && <div className={styles.attachmentField}><label htmlFor="composer-image-url">Image URL</label><input id="composer-image-url" name="imageUrl" type="url" value={imageUrl} onChange={event => setImageUrl(event.currentTarget.value)} placeholder="https://example.com/image.jpg" /><label htmlFor="composer-alt">Image description <span>(optional)</span></label><input id="composer-alt" name="altText" type="text" maxLength={imageRules.maxAltCharacters} value={altText} onChange={event => setAltText(event.currentTarget.value)} /></div>}
        {attachmentKind === 'videoUrl' && <div className={styles.attachmentField}><label htmlFor="composer-video-url">Video URL</label><input id="composer-video-url" name="videoUrl" type="url" value={videoUrl} onChange={event => setVideoUrl(event.currentTarget.value)} placeholder="https://example.com/video.mp4" /></div>}
        <small>Attachment support depends on the selected destination.</small>
      </fieldset>

    </form>

    <section className={styles.previewPanel} aria-labelledby="composer-preview-title">
      <div className={styles.previewHeading}><h2 id="composer-preview-title">Preview</h2><span>Neutral preview</span></div>
      <div className={styles.unsavedLabel}>Unsaved preview · no destination response is available yet</div>
      <PostPreview post={previewPost} authorName={authorName || 'Your team'} timeZone={schedule.timeZone} variant="card" />
      {attachmentKind === 'upload' && filePreview && <div className={styles.previewLocalImage}><img src={filePreview} alt={altText.trim() || 'Selected post image'} /><span>Selected image</span></div>}
      {mode === 'schedule' && scheduleDate && scheduleTime && <p className={styles.schedulePreview}>Will schedule for {scheduleDate} at {scheduleTime} ({schedule.timeZone.replaceAll('_', ' ')}).</p>}
    </section>

    <SidebarDock>
      <aside className={styles.sidebarControls} aria-label="Post destinations and timing">
        <div className={styles.actions}>
          <button form={FORM_ID} type="submit" name="intent" value="draft" disabled={pending || uploading} onClick={() => setMode('draft')}>{uploading ? 'Uploading…' : pending ? 'Saving…' : 'Save draft'}</button>
          <button form={FORM_ID} type="submit" name="intent" value="schedule" disabled={pending || uploading} onClick={() => setMode('schedule')}>{uploading ? 'Uploading…' : pending ? 'Saving…' : 'Schedule post'}</button>
        </div>
        <fieldset className={styles.destinationList}>
          <legend>Destinations</legend>
          {targets.filter(target => target.canPublish).length ? targets.filter(target => target.canPublish).map(target => <label key={target.id}>
            <input form={FORM_ID} type="checkbox" name="targetIds" value={target.id} checked={selectedTargets.includes(target.id)} onChange={event => { const checked = event.currentTarget.checked; setSelectedTargets(current => checked ? [...current, target.id] : current.filter(id => id !== target.id)); }} />
            <span>{target.name}</span>
          </label>) : <p>No destinations are ready to publish right now.</p>}
          <small>Drafts can be saved without a destination. Scheduling needs at least one.</small>
        </fieldset>
        <fieldset className={styles.scheduleFields}>
          <legend>Schedule</legend>
          <p>Times use {schedule.timeZone.replaceAll('_', ' ')}.</p>
          <label htmlFor="composer-date">Date</label><input form={FORM_ID} id="composer-date" type="date" name="scheduleDate" value={scheduleDate} onChange={event => setScheduleDate(event.currentTarget.value)} />
          <label htmlFor="composer-time">Time</label><input form={FORM_ID} id="composer-time" type="time" name="scheduleTime" value={scheduleTime} onChange={event => setScheduleTime(event.currentTarget.value)} />
        </fieldset>
      </aside>
    </SidebarDock>
  </div>;
}
