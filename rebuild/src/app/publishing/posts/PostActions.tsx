"use client";
import { SidebarDock } from '@/components/SidebarDock';
import { DestinationFormats, effectiveDestinationFormat } from '@/modules/publishing/components/DestinationFormats';
import { usePreserveFormState } from '@/components/usePreserveFormState';
import { AutoTextarea } from '@/components/AutoTextarea';

import { cancelScheduledPostAction, deletePostWithRecoveryAction, importPostsAction, publishPostAction, recordFirstCommentOutcomeAction, schedulePostAction, sendFirstCommentAction, submitForApprovalAction, syncPostAction, updatePostWithRecoveryAction, type ComposerValues, type FirstCommentActionState, type PostDeleteActionState, type PostEditActionState } from "./actions";
import { startTransition, useActionState, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { flushSync } from 'react-dom';
import { Button } from "@/components";
import { ModalDialog } from "@/components/ModalDialog";
import styles from "../publishing.module.css";
import { csvDestinationLabel } from '@/lib/publishing/csv-destinations';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { validateFields } from '@/lib/ui/form-validation';
import { FIRST_COMMENT_LABELS, firstCommentState } from '@/modules/publishing/first-comment-state';
import { PublicationRecovery } from './PublicationRecovery';
import { DuplicatePost } from './DuplicatePost';
import { QueuePostButton } from './QueuePostButton';
import { AuthoringMediaPreview, PostAttachments, usePostAttachments, type PostMediaItem } from '@/modules/publishing/components/PostAttachments';
import { publishingMediaIssue } from '@/modules/publishing/media-support';
import type { PublishingFormatDescriptor, PublishingMediaSupport } from '@/platforms/types';
import { formatPostPreviewTime } from '@/components/PostPreview';

type LocalImageUpload = { maxBytes: number; mimeTypes: readonly string[] };
type TargetChoice = { id: string; name: string; type: string; provider: string | null; canPublish: boolean; publishingMedia?: PublishingMediaSupport; publishingFormats?: readonly PublishingFormatDescriptor[]; defaultPublishingFormatId?: string; localImageUpload?: LocalImageUpload };
type ImageRules = { allowedMimeTypes: string[]; maxUploadBytes: number; maxAltCharacters: number; maxMedia: number; maxFirstCommentDelayMinutes: number };
type PostRow = { format?: string; id: string; message: string; firstComment: string | null; firstCommentDelayMinutes?: number; link: string | null; media: Array<{kind: string; url: string; altText?: string}>; status: string; publishedAt: Date | null; targets: Array<{ id: string; formatId?: string | null; status: string; remotePostId: string | null; publishedAt?: Date | string | null; firstCommentId?: string | null; firstCommentAt?: Date | string | null; firstCommentError?: string | null; target: { id: string; name?: string | null } }> };

const MEDIA_KINDS = ['image', 'video'] as const;

function readFormatValues(value: string | undefined): Record<string,string> {
  try { const parsed: unknown = JSON.parse(value ?? '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string,string] => typeof entry[1] === 'string')) : {}; } catch { return {}; }
}

function allowedMediaKinds(targets: TargetChoice[]) {
  return targets.length ? MEDIA_KINDS.filter(kind => targets.every(target => target.publishingMedia?.kinds.includes(kind))) : [...MEDIA_KINDS];
}

function localUploadRules(targets: TargetChoice[], rules: ImageRules) {
  if (!targets.length) return { allowedMimeTypes: rules.allowedMimeTypes, maxUploadBytes: rules.maxUploadBytes };
  if (targets.some(target => !target.localImageUpload)) return { allowedMimeTypes: [], maxUploadBytes: 0 };
  const uploadRules = targets.map(target => target.localImageUpload!);
  return {
    allowedMimeTypes: rules.allowedMimeTypes.filter(mime => uploadRules.every(upload => upload.mimeTypes.includes(mime))),
    maxUploadBytes: Math.min(rules.maxUploadBytes, ...uploadRules.map(upload => upload.maxBytes)),
  };
}

function localUploadIssue(targets: TargetChoice[], items: ReturnType<typeof usePostAttachments>['items']) {
  for (const target of targets) {
    for (const item of items.filter(candidate => candidate.source === 'upload' && candidate.file)) {
      const upload = target.localImageUpload;
      const file = item.file!;
      if (!upload) return `${target.name} does not currently support local image uploads. Remove the uploaded image or choose another destination.`;
      if (!upload.mimeTypes.includes(file.type)) return `${target.name} does not accept ${file.type || 'this image format'}. Choose another image or destination.`;
      if (file.size > upload.maxBytes) return `${target.name} accepts images up to ${Math.ceil(upload.maxBytes / 1048576)} MB. Choose another image or destination.`;
    }
  }
  return null;
}

function selectedMediaIssue(targets: TargetChoice[], media: readonly PostMediaItem[], link: string, items: ReturnType<typeof usePostAttachments>['items']) {
  const completeMedia = items.map(item => ({ kind: item.kind, url: item.url || 'media:pending', ...(item.altText === undefined ? {} : { altText: item.altText }) }));
  for (const target of targets) {
    const issue = publishingMediaIssue(target.publishingMedia, completeMedia.length ? completeMedia : media, link);
    if (issue) return `${target.name}: ${issue}`;
  }
  return localUploadIssue(targets, items);
}

function postValidationErrors(form: HTMLFormElement, hasOtherContent = false) {
  return validateFields(form, {
    message: { empty: hasOtherContent ? '' : 'Add post text, a link, or media before saving. A first comment alone is not a post.' },
    link: { invalid: 'Enter a complete link, such as https://example.com.' },
  });
}

function focusAlert(form: HTMLFormElement | null) {
  const alert = form?.querySelector<HTMLElement>('[role="alert"]');
  if (!alert) return;
  if (!alert.hasAttribute('tabindex')) alert.tabIndex = -1;
  alert.focus();
}

function parseInitialMedia(value: string): PostMediaItem[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PostMediaItem => Boolean(item && typeof item === 'object'
      && ((item as PostMediaItem).kind === 'image' || (item as PostMediaItem).kind === 'video')
      && typeof (item as PostMediaItem).url === 'string'));
  } catch { return []; }
}

export function CsvImportForm({ targets }: { targets: TargetChoice[] }) {
  const [error, setError] = useState('');
  return <form noValidate action={importPostsAction} className={styles.draftForm} onSubmit={event => {
    const input = event.currentTarget.elements.namedItem('csv');
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]?.size) {
      event.preventDefault(); setError('Choose a non-empty CSV file to import.'); input instanceof HTMLInputElement && input.focus();
    } else setError('');
  }}>
    <label htmlFor="posts-csv">Import posts from CSV</label>
    <p className={styles.help}>Required header: <code>message,firstComment,channels</code>. Optional: <code>firstCommentDelayMinutes</code> (whole minutes; defaults to 0). Use the channel labels below; separate multiple channels with semicolons. Leave channels empty to import a local draft. Imported posts remain drafts.</p>
    <ul className={styles.targetReference}>{targets.filter(target => target.canPublish).map(target => <li key={target.id}>{csvDestinationLabel(target)}</li>)}</ul>
    <input id="posts-csv" type="file" name="csv" accept=".csv,text/csv" required aria-invalid={Boolean(error)} aria-describedby={error ? 'posts-csv-error' : undefined} />
    {error && <p id="posts-csv-error" className={styles.formError}>{error}</p>}
    <button className="ui-button ui-button--secondary" type="submit">Import CSV</button>
  </form>;
}

export function PostRowActions({ post, targets, canEdit, canPublish, imageRules, canDuplicate = false, canOrganize = false, canQueue = false, timeZone = 'UTC' }: { post: PostRow; targets: TargetChoice[]; canEdit: boolean; canPublish: boolean; imageRules: ImageRules; canDuplicate?: boolean; canOrganize?: boolean; canQueue?: boolean; timeZone?: string }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const rowPending = editPending || deletePending || duplicatePending;
  const selected = new Set(post.targets.map(item => item.target.id));
  const hasRemote = post.targets.some(item => Boolean(item.remotePostId));
  const isDraft = post.status === 'draft' && !post.publishedAt;
  const queueDestinations = post.targets.filter(target => target.status === 'pending' && !target.remotePostId);
  const isQueueEligible = canEdit && ['draft', 'rejected'].includes(post.status) && queueDestinations.length > 0;
  const isQueued = post.status === 'scheduled';
  return <div className={styles.rowActions}>
    {canOrganize && <a className="ui-button ui-button--secondary ui-button--sm" href={`/publishing/collaboration/post/${encodeURIComponent(post.id)}`}>Organize post</a>}
    {canDuplicate ? <DuplicatePost postId={post.id} disabled={rowPending} onPendingChange={setDuplicatePending} /> : null}
    {canQueue ? <QueuePostButton postId={post.id} postMessage={post.message} destinations={queueDestinations.map(target => target.target.name ?? 'Destination')} timeZone={timeZone} eligible={isQueueEligible} /> : null}
    {canEdit && isDraft ? <details className={styles.editDetails}>
      <summary onClick={event => { if (rowPending) event.preventDefault(); }}>Edit post</summary>
      <PostEditForm post={post} targets={targets} selected={selected} imageRules={imageRules} disabled={rowPending} onPendingChange={setEditPending} />
    </details> : null}
    {canPublish && isDraft && post.targets.length ? <form noValidate action={publishPostAction}>
      <input type="hidden" name="postId" value={post.id} />
      <button className="ui-button ui-button--primary ui-button--sm" type="submit" disabled={rowPending}>Publish now</button>
    </form> : null}
    {canEdit && isDraft && post.targets.length ? <>
      <form noValidate action={submitForApprovalAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={rowPending}>Submit for approval</button></form>
      <ScheduleForm postId={post.id} disabled={rowPending}/>
    </> : null}
    {canEdit && isQueued ? <form noValidate action={cancelScheduledPostAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={rowPending}>Cancel schedule</button></form> : null}
    {hasRemote ? <form noValidate action={syncPostAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={rowPending}>Sync status</button></form> : null}
    <PublicationRecovery postId={post.id} excerpt={post.message} targets={post.targets.map(item => ({ id: item.id, name: item.target.name, status: item.status, remotePostId: item.remotePostId }))} />
    {post.firstComment?.trim() ? <section className={styles.help} aria-label="First comment status">
      <strong>First comment delivery</strong>
      {post.targets.map(target => <FirstCommentControl key={target.id} postId={post.id} postComment={post.firstComment!} delayMinutes={post.firstCommentDelayMinutes ?? 0} timeZone={timeZone} target={target} />)}
    </section> : null}
    <Button variant="danger" size="sm" type="button" disabled={rowPending} onClick={() => setDeleteOpen(true)}>Delete locally</Button>
    {deleteOpen && <PostDeleteDialog postId={post.id} postMessage={post.message} hasRemote={hasRemote} onDismiss={() => setDeleteOpen(false)} onPendingChange={setDeletePending} />}
  </div>;
}

function FirstCommentControl({ postId, postComment, delayMinutes, timeZone, target }: { postId: string; postComment: string; delayMinutes: number; timeZone: string; target: PostRow['targets'][number] }) {
  const [mode, setMode] = useState<'send' | 'record' | null>(null);
  const [localState, setLocalState] = useState<FirstCommentActionState['state'] | null>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const focusAfterComplete = useRef(false);
  const state = firstCommentState(postComment, target);
  const serverVersion = JSON.stringify([target.status, target.remotePostId, target.firstCommentId, target.firstCommentAt, target.firstCommentError]);
  useEffect(() => { setLocalState(null); }, [serverVersion]);
  useEffect(() => {
    if (mode === null && focusAfterComplete.current) {
      focusAfterComplete.current = false;
      controlRef.current?.focus();
    }
  }, [mode]);
  const displayState = localState ?? state;
  const publishedAt = target.publishedAt ? new Date(target.publishedAt) : null;
  const dueAt = publishedAt && Number.isFinite(publishedAt.getTime()) ? new Date(publishedAt.getTime() + delayMinutes * 60_000) : null;
  const isScheduled = displayState === 'ready' && delayMinutes > 0;
  const stateText = displayState === 'scheduled' ? 'First comment is scheduled'
    : isScheduled && dueAt ? `First comment scheduled for ${formatPostPreviewTime(dueAt, timeZone)} (${timeZone.replaceAll('_', ' ')})`
      : isScheduled ? `First comment waits ${delayMinutes.toLocaleString()} minutes after publication`
        : FIRST_COMMENT_LABELS[displayState];
  const open = (next: 'send' | 'record') => setMode(next);

  return <div ref={controlRef} className={styles.firstCommentRow} role="group" aria-label={`First comment delivery for ${target.target.name ?? 'this destination'}`} tabIndex={-1} data-first-comment-control>
    <span>{target.target.name ?? 'Destination'}: {stateText}</span>
    {displayState === 'ready' ? <Button type="button" size="sm" onClick={() => open('send')}>{delayMinutes > 0 ? 'Send now' : 'Send first comment'}</Button> : null}
    {displayState === 'needs_review' ? <Button type="button" size="sm" onClick={() => open('record')}>Record comment outcome</Button> : null}
    {mode ? <FirstCommentDialog key={`${target.id}:${mode}`} mode={mode} postId={postId} postComment={postComment} delayMinutes={delayMinutes} target={target} onDismiss={() => setMode(null)} onProgress={setLocalState} onComplete={state => { focusAfterComplete.current = true; setLocalState(state); setMode(null); }} /> : null}
  </div>;
}

function FirstCommentDialog({ mode, postId, postComment, delayMinutes, target, onDismiss, onProgress, onComplete }: { mode: 'send' | 'record'; postId: string; postComment: string; delayMinutes: number; target: PostRow['targets'][number]; onDismiss: () => void; onProgress: (state: FirstCommentActionState['state']) => void; onComplete: (state: FirstCommentActionState['state']) => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | 'not_sent'>('not_sent');
  const [remoteId, setRemoteId] = useState('');
  const [sendState, sendAction, sendPending] = useActionState(runSendFirstCommentWithRecovery, { status: 'idle', postId, postTargetId: target.id } satisfies FirstCommentActionState);
  const [recordState, recordAction, recordPending] = useActionState(runRecordFirstCommentWithRecovery, { status: 'idle', postId, postTargetId: target.id } satisfies FirstCommentActionState);
  const activeResult = mode === 'send' ? sendState : recordState;
  const pending = sendPending || recordPending;
  useEffect(() => {
    if (activeResult.status === 'success' && activeResult.state) onComplete(activeResult.state);
    else if (activeResult.status === 'error' && activeResult.state) onProgress(activeResult.state);
  }, [activeResult, onComplete, onProgress]);
  return <ModalDialog className="ui-dialog" labelledBy={`first-comment-title-${target.id}`} onDismiss={() => { if (!pending) onDismiss(); }} busy={pending} initialFocus={activeResult.status === 'error' ? '[data-first-comment-error]' : '[data-first-comment-cancel]'}>
    {mode === 'send' ? <form noValidate onSubmit={event => {
      event.preventDefault();
      if (!acknowledged || pending) return;
      const data = new FormData(event.currentTarget);
      // Explicit dispatch avoids React's native form reset after an error receipt.
      startTransition(() => sendAction(data));
    }}>
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="postTargetId" value={target.id} />
      <input type="hidden" name="confirmation" value={acknowledged ? `SEND FIRST COMMENT ${target.id}` : ''} />
      <div className="ui-dialog__header"><div><h2 id={`first-comment-title-${target.id}`}>Send the first comment now?</h2><p>This sends the saved comment to {target.target.name ?? 'this destination'} once{delayMinutes > 0 ? ', without waiting for its saved delay' : ''}.</p></div></div>
      <div className="ui-dialog__body">
        <p className={styles.help}>{postComment}</p>
        <p>If the platform accepts it but the response is delayed, the result will need review. Check its current status before any further action.</p>
        <label className={styles.confirmCheck}><input type="checkbox" name="acknowledged" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.currentTarget.checked)} /> I understand the result may be delayed and I will check status before repeating.</label>
        {sendState.status === 'error' ? <p className="ui-error" role="alert" data-first-comment-error tabIndex={-1}>{sendState.message ?? 'The send result could not be confirmed. Check its current state before another action.'}</p> : null}
      </div>
      <div className="ui-dialog__actions"><Button type="button" data-first-comment-cancel disabled={pending} onClick={onDismiss}>Cancel</Button><Button variant="primary" type="submit" disabled={pending || !acknowledged}>Send now</Button></div>
    </form> : <form noValidate onSubmit={event => {
      event.preventDefault();
      if (!acknowledged || pending || (outcome === 'sent' && !remoteId.trim())) return;
      const data = new FormData(event.currentTarget);
      startTransition(() => recordAction(data));
    }}>
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="postTargetId" value={target.id} />
      <input type="hidden" name="confirmation" value={acknowledged ? `RECORD FIRST COMMENT ${target.id} ${outcome === 'sent' ? 'SENT' : 'NOT SENT'}` : ''} />
      <div className="ui-dialog__header"><div><h2 id={`first-comment-title-${target.id}`}>Record the platform check</h2><p>This records your manual check. The app will not contact or verify the platform.</p></div></div>
      <div className="ui-dialog__body">
        <p>The original request may still complete later. Confirm the current platform outcome before choosing below.</p>
        <fieldset className={styles.targetPicker} disabled={pending}><legend>What did you verify?</legend>
          <label><input type="radio" name="outcomeChoice" value="not_sent" checked={outcome === 'not_sent'} onChange={() => setOutcome('not_sent')} /> The comment is not present</label>
          <label><input type="radio" name="outcomeChoice" value="sent" checked={outcome === 'sent'} onChange={() => setOutcome('sent')} /> The comment is present</label>
        </fieldset>
        <input type="hidden" name="outcome" value={outcome} />
        {outcome === 'sent' ? <label className="ui-field" htmlFor={`first-comment-remote-id-${target.id}`}><span>Platform comment ID</span><input className="ui-input" id={`first-comment-remote-id-${target.id}`} name="remoteId" value={remoteId} onChange={event => setRemoteId(event.currentTarget.value)} required disabled={pending} /></label> : <input type="hidden" name="remoteId" value="" />}
        <label className={styles.confirmCheck}><input type="checkbox" name="acknowledged" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.currentTarget.checked)} /> I checked the platform outside this app and understand a late result may still appear.</label>
        {recordState.status === 'error' ? <p className="ui-error" role="alert" data-first-comment-error tabIndex={-1}>{recordState.message ?? 'The outcome could not be recorded. Check the current state before trying again.'}</p> : null}
      </div>
      <div className="ui-dialog__actions"><Button type="button" data-first-comment-cancel disabled={pending} onClick={onDismiss}>Cancel</Button><Button variant="primary" type="submit" disabled={pending || !acknowledged || (outcome === 'sent' && !remoteId.trim())}>Record result</Button></div>
    </form>}
  </ModalDialog>;
}

export async function runSendFirstCommentWithRecovery(previous: FirstCommentActionState, data: FormData): Promise<FirstCommentActionState> {
  const postId = typeof data.get('postId') === 'string' ? String(data.get('postId')) : previous.postId;
  const postTargetId = typeof data.get('postTargetId') === 'string' ? String(data.get('postTargetId')) : previous.postTargetId;
  try { return await sendFirstCommentAction(previous, data); }
  catch (error) {
    if (isActionRedirect(error)) throw error;
    return { status: 'error', postId, postTargetId, state: 'needs_review', message: 'The send result is unconfirmed. Check the platform and current post before sending or recording an outcome.' };
  }
}

export async function runRecordFirstCommentWithRecovery(previous: FirstCommentActionState, data: FormData): Promise<FirstCommentActionState> {
  const postId = typeof data.get('postId') === 'string' ? String(data.get('postId')) : previous.postId;
  const postTargetId = typeof data.get('postTargetId') === 'string' ? String(data.get('postTargetId')) : previous.postTargetId;
  const submittedOutcome = data.get('outcome');
  const outcome = submittedOutcome === 'sent' || submittedOutcome === 'not_sent' ? submittedOutcome : previous.outcome;
  const submittedId = data.get('remoteId');
  const remoteId = typeof submittedId === 'string' ? submittedId : previous.remoteId;
  try { return await recordFirstCommentOutcomeAction(previous, data); }
  catch (error) {
    if (isActionRedirect(error)) throw error;
    return { status: 'error', postId, postTargetId, state: 'needs_review', outcome, remoteId, message: 'The outcome is unconfirmed. Check the current post before repeating or taking another action.' };
  }
}

function PostEditForm({ post, targets, selected, imageRules, disabled, onPendingChange }: { post: PostRow; targets: TargetChoice[]; selected: Set<string>; imageRules: ImageRules; disabled: boolean; onPendingChange: (pending: boolean) => void }) {
  const initialValues: Partial<ComposerValues> = {
    intent: '', mediaJson: JSON.stringify(post.media), destinationFormatsJson: JSON.stringify(Object.fromEntries(post.targets.map(t => [t.target.id, t.formatId ?? post.format]).filter((entry): entry is [string,string] => typeof entry[1] === 'string'))), message: post.message, firstComment: post.firstComment ?? '', firstCommentDelayMinutes: String(post.firstCommentDelayMinutes ?? 0), link: post.link ?? '',
    targetIds: [...selected], scheduleDate: '', scheduleTime: '',
  };
  const [actionState, formAction, pending] = useActionState(runUpdatePostWithRecovery, { status: 'idle', values: initialValues } satisfies PostEditActionState);
  const [values, setValues] = useState<Partial<ComposerValues>>(initialValues);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const validation = useFormValidation();
  const formRef = useRef<HTMLFormElement>(null);
  usePreserveFormState(formRef);
  const lastApplied = useRef<PostEditActionState | null>(null);

  useEffect(() => { onPendingChange(pending); }, [onPendingChange, pending]);
  useEffect(() => {
    if (actionState.status !== 'error' || actionState === lastApplied.current) return;
    lastApplied.current = actionState;
    setValues(current => ({ ...current, ...actionState.values }));
    formRef.current?.querySelector<HTMLElement>('[data-edit-error]')?.focus();
  }, [actionState]);
  function setValue(name: keyof ComposerValues, value: string) { setValues(current => ({ ...current, [name]: value })); validation.clear(name); }
  const targetIds = new Set(values.targetIds ?? selected);
  const selectedTargets = targets.filter(target => targetIds.has(target.id) && target.canPublish);
  const formatChoices = readFormatValues(values.destinationFormatsJson);
  const serializedFormats = JSON.stringify(Object.fromEntries(selectedTargets.flatMap(target => {
    const id = effectiveDestinationFormat(target, formatChoices); return id === undefined ? [] : [[target.id, id]];
  })));
  const formatTargets = selectedTargets.map(target => ({ ...target, publishingMedia: target.publishingFormats?.find(format => format.id === effectiveDestinationFormat(target, formatChoices))?.media ?? target.publishingMedia }));
  const delayField = validation.fieldProps('firstCommentDelayMinutes', `comment-delay-help-${post.id}`);
  const uploadRules = localUploadRules(formatTargets, imageRules);
  const attachments = usePostAttachments({
    initialMedia: parseInitialMedia(initialValues.mediaJson ?? '[]'),
    maxMedia: imageRules.maxMedia,
    maxAltCharacters: imageRules.maxAltCharacters,
    allowedMimeTypes: uploadRules.allowedMimeTypes,
    maxUploadBytes: uploadRules.maxUploadBytes,
    allowedKinds: allowedMediaKinds(formatTargets),
    allowMixedKinds: !formatTargets.length || formatTargets.every(target => target.publishingMedia?.mixedKinds === true),
  });
  useEffect(() => { if (attachments.error) focusAlert(formRef.current); }, [attachments.error]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const linkField = form.elements.namedItem('link');
    const link = linkField instanceof HTMLInputElement ? linkField.value : '';
    const hasOtherContent = Boolean(link.trim() || attachments.items.some(item => item.file || item.url.trim()));
    if (!validation.validate(form, postValidationErrors(form, hasOtherContent))) { event.preventDefault(); return; }
    if (!attachments.validate()) { event.preventDefault(); focusAlert(form); return; }
    const issue = selectedMediaIssue(formatTargets, attachments.media, link, attachments.items);
    if (issue) { event.preventDefault(); attachments.setError(issue); return; }
    const hasPendingUploads = attachments.items.some(item => item.source === 'upload' && item.file);
    if (!hasPendingUploads) { setUploadMessage(''); return; }

    event.preventDefault();
    if (form.dataset.uploading === 'true') return;
    form.dataset.uploading = 'true';
    setUploading(true);
    setUploadMessage('Uploading images…');
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    try {
      if (!await attachments.prepareUploads()) {
        setUploadMessage('Some images could not be uploaded. Your order and descriptions are still here; fix the marked items and retry.');
        return;
      }
      setUploadMessage('');
      form.dataset.uploading = 'false';
      flushSync(() => setUploading(false));
      form.requestSubmit(submitter instanceof HTMLElement ? submitter as HTMLButtonElement : undefined);
    } catch {
      setUploadMessage('We could not upload every image. Your post details are still here; try again.');
    } finally {
      form.dataset.uploading = 'false';
      setUploading(false);
    }
  }

  return <form id={`post-edit-${post.id}`} ref={formRef} noValidate action={formAction} className={styles.editForm} onSubmit={event => {
    void onSubmit(event);
  }}>
    <input type="hidden" name="postId" value={post.id} />
    <input type="hidden" name="destinationFormatsJson" value={serializedFormats} />
    <SidebarDock><fieldset className="ui-field"><legend>Post formats</legend><DestinationFormats targets={targets} selectedIds={selectedTargets.map(target=>target.id)} values={formatChoices} onChange={(id,value) => setValues(current => ({...current,destinationFormatsJson:JSON.stringify({...readFormatValues(current.destinationFormatsJson),[id]:value})}))} formId={`post-edit-${post.id}`} disabled={disabled || pending || uploading} /></fieldset></SidebarDock>
    <fieldset className={styles.formFields}>
      <label htmlFor={`message-${post.id}`}>Post text <span>(optional with a link or media)</span></label>
      <AutoTextarea id={`message-${post.id}`} name="message" value={values.message ?? post.message} onChange={event => setValue('message', event.currentTarget.value)} rows={4} disabled={disabled || pending || uploading} aria-invalid={Boolean(validation.errors.message)} aria-describedby={validation.errors.message ? `message-error-${post.id}` : undefined} />
      {validation.errors.message && <p id={`message-error-${post.id}`} className={styles.formError} role="alert">{validation.errors.message}</p>}
      <label htmlFor={`comment-${post.id}`}>First comment <span>(optional)</span></label>
      <AutoTextarea id={`comment-${post.id}`} name="firstComment" value={values.firstComment ?? post.firstComment ?? ''} onChange={event => setValue('firstComment', event.currentTarget.value)} rows={2} disabled={disabled || pending || uploading} />
      <label htmlFor={delayField.id}>Wait before the first comment <span>(minutes; 0 sends it right after publication)</span></label>
      <input name="firstCommentDelayMinutes" type="number" inputMode="numeric" min={0} max={imageRules.maxFirstCommentDelayMinutes} step={1} value={values.firstCommentDelayMinutes ?? String(post.firstCommentDelayMinutes ?? 0)} onChange={event => setValue('firstCommentDelayMinutes', event.currentTarget.value)} disabled={disabled || pending || uploading} {...delayField} />
      <p id={`comment-delay-help-${post.id}`} className={styles.help}>Choose a whole number from 0 to {imageRules.maxFirstCommentDelayMinutes.toLocaleString()} minutes.</p>
      <FieldError {...validation.errorProps('firstCommentDelayMinutes')} />
      <label htmlFor={`link-${post.id}`}>Link <span>(optional)</span></label><input id={`link-${post.id}`} name="link" type="url" value={values.link ?? post.link ?? ''} onChange={event => setValue('link', event.currentTarget.value)} disabled={disabled || pending || uploading} aria-invalid={Boolean(validation.errors.link)} aria-describedby={validation.errors.link ? `link-error-${post.id}` : undefined} />
      {validation.errors.link && <p id={`link-error-${post.id}`} className={styles.formError} role="alert">{validation.errors.link}</p>}
      <PostAttachments controller={attachments} disabled={disabled || pending || uploading} />
      <AuthoringMediaPreview controller={attachments} />
      <TargetPicker targets={targets} selected={targetIds} disabled={disabled || pending || uploading} onSelectionChange={next => setValues(current => ({ ...current, targetIds: [...next] }))} />
      {actionState.status === 'error' && <p className={styles.formError} role="alert" data-edit-error tabIndex={-1}>{actionState.message ?? 'The post could not be saved. Your changes are still here; try again.'}</p>}
      {uploadMessage && <p className={styles.formError} role="status">{uploadMessage}</p>}
      <Button size="sm" type="submit" disabled={disabled || pending || uploading}>{uploading ? 'Uploading…' : pending ? 'Saving…' : 'Save post'}</Button>
    </fieldset>
  </form>;
}

function PostDeleteDialog({ postId, postMessage, hasRemote, onDismiss, onPendingChange }: { postId: string; postMessage: string; hasRemote: boolean; onDismiss: () => void; onPendingChange: (pending: boolean) => void }) {
  const [actionState, formAction, pending] = useActionState(runDeletePostWithRecovery, { status: 'idle', deleteRemote: false } satisfies PostDeleteActionState);
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const lastReceipt = useRef(actionState.receipt);
  useEffect(() => { onPendingChange(pending); }, [onPendingChange, pending]);
  useEffect(() => {
    if (lastReceipt.current !== actionState.receipt) {
      lastReceipt.current = actionState.receipt;
      setAcknowledged(false);
    }
  }, [actionState.receipt]);
  const initialFocus = actionState.status === 'error' ? '[data-dialog-error]' : '[data-dialog-cancel]';
  return <ModalDialog className="ui-dialog" labelledBy={`delete-title-${postId}`} onDismiss={onDismiss} busy={pending} initialFocus={initialFocus}>
    <form ref={formRef} noValidate onSubmit={event => event.preventDefault()}>
      <input type="hidden" name="postId" value={postId} />
      <div className="ui-dialog__header"><div><h2 id={`delete-title-${postId}`}>Delete this post locally?</h2><p>This permanently removes the post and its local publishing history.</p></div></div>
      <div className="ui-dialog__body">
        <p><strong>Post text</strong></p>
        <p className={styles.help} style={{ overflowWrap: 'anywhere', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden' }}>{postMessage}</p>
        <p>{hasRemote ? 'Choose whether to request deletion of recorded remote posts. Unconfirmed outcomes stay available here for review.' : 'No remote post is recorded for this item; only the local post and its history will be removed.'}</p>
        {hasRemote ? <label className={styles.confirmCheck}><input type="checkbox" name="deleteRemote" checked={deleteRemote} disabled={pending} onChange={event => setDeleteRemote(event.currentTarget.checked)} /> Also request deletion of recorded remote posts.</label> : null}
        {actionState.receipt ? <section aria-label="Deletion status">
          <p role={actionState.status === 'error' ? 'alert' : 'status'}><strong>Deletion status:</strong> {actionState.receipt.state.replaceAll('_', ' ')}. {actionState.message}</p>
          {actionState.receipt.operations.map(operation => <div className={styles.firstCommentRow} key={operation.operationId}>
            <span>{operation.targetName ?? 'Destination'}: {deletionOperationLabel(operation.state, operation.remoteConfirmed)}</span>
            {['started', 'uncertain'].includes(operation.state) ? <>
              <Button type="button" size="sm" disabled={pending || !acknowledged} onClick={() => submit('record', { operationId: operation.operationId, outcome: 'deleted' })}>Record deleted</Button>
              <Button type="button" size="sm" disabled={pending || !acknowledged} onClick={() => submit('record', { operationId: operation.operationId, outcome: 'not_deleted' })}>Record not deleted</Button>
            </> : null}
          </div>)}
        </section> : null}
        {actionState.receipt?.operations.some(operation => operation.state === 'started' || operation.state === 'uncertain') ? <div>
          <p>The original request may still complete later. For each destination, check the platform yourself before recording an outcome.</p>
          <label className={styles.confirmCheck}><input type="checkbox" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.currentTarget.checked)} /> I checked the platform outside this app and understand a late deletion result may still appear.</label>
        </div> : null}
        {actionState.status === 'error' && <p className="ui-error" role="alert" data-dialog-error tabIndex={-1}>{actionState.message ?? 'We could not confirm whether this post was deleted. Check its current status before trying again.'}</p>}
      </div>
      <div className="ui-dialog__actions"><Button type="button" data-dialog-cancel disabled={pending} onClick={onDismiss}>Close</Button><Button type="button" disabled={pending} onClick={() => submit('status')}>Check deletion status</Button>{actionState.receipt?.state === 'local_pending' ? <Button variant="danger" type="button" disabled={pending} onClick={() => submit('finish')}>Finish local removal</Button> : <Button variant="danger" type="button" disabled={pending || actionState.receipt?.operations.some(operation => operation.state === 'started' || operation.state === 'uncertain')} onClick={() => submit('start')}>{actionState.receipt?.operations.some(operation => operation.state === 'rejected') ? 'New deletion request' : 'Delete post'}</Button>}</div>
    </form>
  </ModalDialog>;

  function submit(intent: 'start' | 'status' | 'finish' | 'record', extras: Record<string, string> = {}) {
    const form = formRef.current;
    if (!form || pending) return;
    const data = new FormData(form);
    data.set('intent', intent);
    if (intent === 'start') data.set('confirmation', `DELETE POST ${postId} ${deleteRemote ? 'REMOTE' : 'LOCAL'}`);
    if (intent === 'finish') data.set('confirmation', `FINISH POST DELETION ${postId}`);
    if (intent === 'record') {
      if (!acknowledged) return;
      data.set('verifiedOnPlatform', 'on');
      data.set('confirmation', `RECORD POST DELETION ${extras.operationId} ${extras.outcome === 'deleted' ? 'DELETED' : 'NOT DELETED'}`);
    }
    for (const [name, value] of Object.entries(extras)) data.set(name, value);
    if (intent === 'record' || intent === 'status') setAcknowledged(false);
    startTransition(() => formAction(data));
  }
}

function deletionOperationLabel(state: string, remoteConfirmed: boolean): string {
  if (remoteConfirmed) return 'Remote deletion confirmed';
  switch (state) {
    case 'started': return 'Request started';
    case 'uncertain': return 'Outcome unconfirmed';
    case 'remote_confirmed': return 'Remote deletion confirmed';
    case 'completed': return 'Local cleanup completed';
    case 'rejected': return 'Not deleted';
    default: return 'Needs review';
  }
}

export async function runUpdatePostWithRecovery(previous: PostEditActionState, data: FormData): Promise<PostEditActionState> {
  try { return await updatePostWithRecoveryAction(previous, data); }
  catch (error) {
    if (isActionRedirect(error)) throw error;
    return { status: 'error', message: 'We could not confirm whether this post was saved. Your changes are still here; check the post before trying again.', values: valuesFromFormData(data) };
  }
}

export async function runDeletePostWithRecovery(previous: PostDeleteActionState, data: FormData): Promise<PostDeleteActionState> {
  const deleteRemote = data.get('deleteRemote') === 'on';
  try {
    const result = await deletePostWithRecoveryAction(previous, data);
    if (result.status === 'error' && !result.receipt && previous.receipt) return { ...result, deleteRemote, receipt: previous.receipt };
    return result;
  }
  catch (error) {
    if (isActionRedirect(error)) throw error;
    const operationId = data.get('operationId');
    return { status: 'error', message: 'The deletion result is unconfirmed. Check deletion status before trying again.', deleteRemote, ...(previous.receipt ? { receipt: previous.receipt } : {}), ...(typeof operationId === 'string' ? { operationId } : {}) };
  }
}

function isActionRedirect(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT;'));
}

function valuesFromFormData(data: FormData): Partial<ComposerValues> {
  const value = (name: string) => { const result = data.get(name); return typeof result === 'string' ? result : ''; };
  return { intent: value('intent'), attachmentKind: value('attachmentKind'), mediaJson: value('mediaJson'), message: value('message'), firstComment: value('firstComment'), firstCommentDelayMinutes: value('firstCommentDelayMinutes'), link: value('link'), imageUrl: value('imageUrl'), videoUrl: value('videoUrl'), uploadedImageRef: value('uploadedImageRef'), altText: value('altText'), targetIds: data.getAll('targetIds').filter((item): item is string => typeof item === 'string'), scheduleDate: value('scheduleDate'), scheduleTime: value('scheduleTime') };
}

function ScheduleForm({ postId, disabled = false }: { postId: string; disabled?: boolean }) {
  const validation = useFormValidation();
  return <form noValidate action={schedulePostAction} className={styles.scheduleForm} onSubmit={event => {
    if (disabled) { event.preventDefault(); return; }
    const form = event.currentTarget;
    if (!validation.validate(form)) { event.preventDefault(); return; }
    const input = form.elements.namedItem('localScheduledAt');
    const hidden = form.elements.namedItem('scheduledAt');
    if (input instanceof HTMLInputElement && hidden instanceof HTMLInputElement && input.value) {
      const date = new Date(input.value);
      if (Number.isFinite(date.getTime())) hidden.value = date.toISOString();
    }
  }}>
    <input type="hidden" name="postId" value={postId}/>
    <fieldset disabled={disabled} className={styles.formFields}>
      <label>Schedule (your local time) <input {...validation.fieldProps('localScheduledAt')} type="datetime-local" name="localScheduledAt" required/></label>
      <FieldError {...validation.errorProps('localScheduledAt')} /><input type="hidden" name="scheduledAt"/>
      <button className="ui-button ui-button--secondary ui-button--sm" type="submit">Add to queue</button>
    </fieldset>
  </form>;
}

function TargetPicker({ targets, selected = new Set<string>(), onSelectionChange, disabled = false }: { targets: TargetChoice[]; selected?: Set<string>; onSelectionChange?: (selected: Set<string>) => void; disabled?: boolean }) {
  const supported = targets.filter(target => target.canPublish);
  return <fieldset className={styles.targetPicker}>
    <legend>Destinations <span>(optional)</span></legend>
    {supported.length ? supported.map(target => <label key={target.id}>
      <input type="checkbox" name="targetIds" value={target.id} disabled={disabled} {...(onSelectionChange ? { checked: selected.has(target.id), onChange: (event: ChangeEvent<HTMLInputElement>) => { const next = new Set(selected); if (event.currentTarget.checked) next.add(target.id); else next.delete(target.id); onSelectionChange(next); } } : { defaultChecked: selected.has(target.id) })} />
      <span>{target.name}</span>
    </label>) : <p>No enabled destinations can publish right now.</p>}
    <small>Only enabled destinations that support publishing are shown.</small>
  </fieldset>;
}
