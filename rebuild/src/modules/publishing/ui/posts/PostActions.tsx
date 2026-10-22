"use client";
import { useComposerCatalog } from '../compose/CopyProvider';
import { usePublishingActionText } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { actionBulkCopy, defaultPublishingActionText, type PublishingActionText } from '@/modules/publishing/action-catalog';
import { DestinationFormats, effectiveDestinationFormat } from '@/modules/publishing/components/DestinationFormats';
import { usePreserveFormState } from '@/components/usePreserveFormState';
import { AutoTextarea } from '@/components/AutoTextarea';

import { retryableDestinationCount } from "@/modules/publishing/bulk";
import { PublishNowButton } from "./PublishNowButton";
import { cancelScheduledPostAction, deletePostWithRecoveryAction, importPostsAction, publishPostAction, recordFirstCommentOutcomeAction, schedulePostAction, sendFirstCommentAction, submitForApprovalAction, syncPostAction, updatePostWithRecoveryAction, type ComposerValues, type FirstCommentActionState, type PostDeleteActionState, type PostEditActionState } from "./actions";
import { startTransition, useActionState, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { flushSync } from 'react-dom';
import { Button } from "@/components";
import { ModalDialog } from "@/components/ModalDialog";
import styles from "@/modules/publishing/ui/publishing.module.css";
import { csvDestinationLabel } from '@/lib/publishing/csv-destinations';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { validateFields } from '@/lib/ui/form-validation';
import { FIRST_COMMENT_REJECTED, firstCommentState } from '@/modules/publishing/first-comment-state';
import { PublicationRecovery } from './PublicationRecovery';
import { FirstCommentRetry } from './FirstCommentRetry';
import { DuplicatePost } from './DuplicatePost';
import { QueuePostButton } from './QueuePostButton';
import { AuthoringMediaPreview, PostAttachments, usePostAttachments, type PostMediaItem } from '@/modules/publishing/components/PostAttachments';
import { publishingMediaIssue, publishingMediaFormatter } from '@/modules/publishing/media-support';
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

function localUploadIssue(targets: TargetChoice[], items: ReturnType<typeof usePostAttachments>['items'], t: PublishingActionText) {
  for (const target of targets) {
    for (const item of items.filter(candidate => candidate.source === 'upload' && candidate.file)) {
      const upload = target.localImageUpload;
      const file = item.file!;
      if (!upload) return t('noUpload', { destination: target.name });
      if (!upload.mimeTypes.includes(file.type)) return t('uploadType', { destination: target.name, format: file.type || t('imageFormat') });
      if (file.size > upload.maxBytes) return t('uploadSize', { destination: target.name, size: Math.ceil(upload.maxBytes / 1048576) });
    }
  }
  return null;
}

function selectedMediaIssue(targets: TargetChoice[], media: readonly PostMediaItem[], link: string, items: ReturnType<typeof usePostAttachments>['items'], t: PublishingActionText, mediaText: ReturnType<typeof publishingMediaFormatter>) {
  const completeMedia = items.map(item => ({ kind: item.kind, url: item.url || 'media:pending', ...(item.altText === undefined ? {} : { altText: item.altText }) }));
  for (const target of targets) {
    const issue = publishingMediaIssue(target.publishingMedia, completeMedia.length ? completeMedia : media, link, mediaText);
    if (issue) return `${target.name}: ${issue}`;
  }
  return localUploadIssue(targets, items, t);
}

function postValidationErrors(form: HTMLFormElement, hasOtherContent = false, t: PublishingActionText = defaultPublishingActionText) {
  return validateFields(form, {
    message: { empty: hasOtherContent ? '' : t('addPostTextALinkOrMedia') },
    link: { invalid: t('enterACompleteLinkSuchAsHttpsexamplecom') },
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
  const t = usePublishingActionText();
  const [error, setError] = useState('');
  return <form noValidate action={importPostsAction} className={styles.draftForm} onSubmit={event => {
    const input = event.currentTarget.elements.namedItem('csv');
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]?.size) {
      event.preventDefault(); setError(t('chooseANonemptyCSVFileToImport')); input instanceof HTMLInputElement && input.focus();
    } else setError('');
  }}>
    <label htmlFor="posts-csv">{t('importPostsFromCSV')}</label>
    <p className={styles.help}>{t('requiredHeader')} <code>message,firstComment,channels</code>{t('optional')} <code>firstCommentDelayMinutes</code> {t('wholeMinutesDefaultsTo0UseThe')}</p>
    <ul className={styles.targetReference}>{targets.filter(target => target.canPublish).map(target => <li key={target.id}>{csvDestinationLabel(target)}</li>)}</ul>
    <input id="posts-csv" type="file" name="csv" accept=".csv,text/csv" required aria-invalid={Boolean(error)} aria-describedby={error ? 'posts-csv-error' : undefined} />
    {error && <p id="posts-csv-error" className={styles.formError}>{error}</p>}
    <button className="ui-button ui-button--secondary" type="submit">{t('importCSV')}</button>
  </form>;
}

export function PostRowActions({ post, targets, canEdit, canPublish, imageRules, canDuplicate = false, canOrganize = false, canQueue = false, timeZone = 'UTC', undoSendSeconds = 0 }: { post: PostRow; targets: TargetChoice[]; canEdit: boolean; canPublish: boolean; imageRules: ImageRules; canDuplicate?: boolean; canOrganize?: boolean; canQueue?: boolean; timeZone?: string; undoSendSeconds?: number }) {
  const t = usePublishingActionText();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const retryCopy = actionBulkCopy(t);
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
    {canOrganize && <a className="ui-button ui-button--secondary ui-button--sm" href={`/content/post/${encodeURIComponent(post.id)}`}>{t('organizePost')}</a>}
    {canDuplicate ? <DuplicatePost postId={post.id} disabled={rowPending} onPendingChange={setDuplicatePending} /> : null}
    {canQueue ? <QueuePostButton postId={post.id} postMessage={post.message} destinations={queueDestinations.map(target => target.target.name ?? t('destination'))} timeZone={timeZone} eligible={isQueueEligible} /> : null}
    {canEdit && isDraft ? <details className={styles.editDetails}>
      <summary onClick={event => { if (rowPending) event.preventDefault(); }}>{t('editPost')}</summary>
      <PostEditForm post={post} targets={targets} selected={selected} imageRules={imageRules} disabled={rowPending} onPendingChange={setEditPending} />
    </details> : null}
    {canPublish && isDraft && post.targets.length ? <PublishNowButton postId={post.id} undoSendSeconds={undoSendSeconds} disabled={rowPending} /> : null}
    {canPublish && retryableDestinationCount(post) > 0 ? <RetryFailedButton postId={post.id} count={retryableDestinationCount(post)} copy={retryCopy} disabled={rowPending} /> : null}
    {canEdit && isDraft && post.targets.length ? <>
      <form noValidate action={submitForApprovalAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={rowPending}>{t('submitForApproval')}</button></form>
      <ScheduleForm postId={post.id} disabled={rowPending}/>
    </> : null}
    {canEdit && isQueued ? <form noValidate action={cancelScheduledPostAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={rowPending}>{t('cancelSchedule')}</button></form> : null}
    {hasRemote ? <form noValidate action={syncPostAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit" disabled={rowPending}>{t('syncStatus')}</button></form> : null}
    <PublicationRecovery postId={post.id} excerpt={post.message} targets={post.targets.map(item => ({ id: item.id, name: item.target.name, status: item.status, remotePostId: item.remotePostId }))} />
    {post.firstComment?.trim() ? <section className={styles.help} aria-label={t('firstCommentStatus')}>
      <strong>{t('firstCommentDelivery')}</strong>
      {post.targets.map(target => <FirstCommentControl key={target.id} postId={post.id} postComment={post.firstComment!} delayMinutes={post.firstCommentDelayMinutes ?? 0} timeZone={timeZone} target={target} />)}
    </section> : null}
    <Button variant="danger" size="sm" type="button" disabled={rowPending} onClick={() => setDeleteOpen(true)}>{t('deleteLocally')}</Button>
    {deleteOpen && <PostDeleteDialog postId={post.id} postMessage={post.message} hasRemote={hasRemote} onDismiss={() => setDeleteOpen(false)} onPendingChange={setDeletePending} />}
  </div>;
}

function FirstCommentControl({ postId, postComment, delayMinutes, timeZone, target }: { postId: string; postComment: string; delayMinutes: number; timeZone: string; target: PostRow['targets'][number] }) {
  const t = usePublishingActionText();
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
  const rejected = displayState === 'ready' && target.firstCommentError === FIRST_COMMENT_REJECTED;
  const isScheduled = !rejected && displayState === 'ready' && delayMinutes > 0;
  const stateText = displayState === 'scheduled' ? t('firstCommentIsScheduled')
    : isScheduled && dueAt ? t('firstCommentScheduled', { time: formatPostPreviewTime(dueAt, timeZone), zone: timeZone.replaceAll('_', ' ') })
      : isScheduled ? t('firstCommentWait', { minutes: delayMinutes.toLocaleString() })
        : t(`comment_${displayState}`);
  const open = (next: 'send' | 'record') => setMode(next);

  return <div ref={controlRef} className={styles.firstCommentRow} role="group" aria-label={t('firstCommentDeliveryFor', { destination: target.target.name ?? t('thisDestination') })} tabIndex={-1} data-first-comment-control>
    <span>{target.target.name ?? t('destination')}{rejected ? ':' : `: ${stateText}`}</span>
    {rejected ? <FirstCommentRetry postId={postId} postTargetId={target.id} destinationName={target.target.name} onSettled={next => { setLocalState(next); if (next !== 'ready') requestAnimationFrame(() => controlRef.current?.focus()); }} /> : null}
    {displayState === 'ready' && !rejected ? <Button type="button" size="sm" onClick={() => open('send')}>{delayMinutes > 0 ? t('sendNow') : t('sendFirstComment')}</Button> : null}
    {displayState === 'needs_review' ? <Button type="button" size="sm" onClick={() => open('record')}>{t('recordCommentOutcome')}</Button> : null}
    {mode ? <FirstCommentDialog key={`${target.id}:${mode}`} mode={mode} postId={postId} postComment={postComment} delayMinutes={delayMinutes} target={target} onDismiss={() => setMode(null)} onProgress={setLocalState} onComplete={state => { focusAfterComplete.current = true; setLocalState(state); setMode(null); }} /> : null}
  </div>;
}

function FirstCommentDialog({ mode, postId, postComment, delayMinutes, target, onDismiss, onProgress, onComplete }: { mode: 'send' | 'record'; postId: string; postComment: string; delayMinutes: number; target: PostRow['targets'][number]; onDismiss: () => void; onProgress: (state: FirstCommentActionState['state']) => void; onComplete: (state: FirstCommentActionState['state']) => void }) {
  const t = usePublishingActionText();
  const [acknowledged, setAcknowledged] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | 'not_sent'>('not_sent');
  const [remoteId, setRemoteId] = useState('');
  const [sendState, sendAction, sendPending] = useActionState((previous: FirstCommentActionState, data: FormData) => runSendFirstCommentWithRecovery(previous, data, t), { status: 'idle', postId, postTargetId: target.id } satisfies FirstCommentActionState);
  const [recordState, recordAction, recordPending] = useActionState((previous: FirstCommentActionState, data: FormData) => runRecordFirstCommentWithRecovery(previous, data, t), { status: 'idle', postId, postTargetId: target.id } satisfies FirstCommentActionState);
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
      <div className="ui-dialog__header"><div><h2 id={`first-comment-title-${target.id}`}>{t('sendTheFirstCommentNow')}</h2><p>{t('thisSendsTheSavedCommentTo')} {target.target.name ?? t('thisDestination')} {t('once')}{delayMinutes > 0 ? t('sendDelayOverride') : ''}.</p></div></div>
      <div className="ui-dialog__body">
        <p className={styles.help}>{postComment}</p>
        <p>{t('ifThePlatformAcceptsItButThe')}</p>
        <label className={styles.confirmCheck}><input type="checkbox" name="acknowledged" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.currentTarget.checked)} /> {t('iUnderstandTheResultMayBeDelayed')}</label>
        {sendState.status === 'error' ? <p className="ui-error" role="alert" data-first-comment-error tabIndex={-1}>{sendState.message ?? t('theSendResultCouldNotBeConfirmed')}</p> : null}
      </div>
      <div className="ui-dialog__actions"><Button type="button" data-first-comment-cancel disabled={pending} onClick={onDismiss}>{t('cancel')}</Button><Button variant="primary" type="submit" disabled={pending || !acknowledged || sendState.state === 'ready'}>{t('sendNow')}</Button></div>
    </form> : <form noValidate onSubmit={event => {
      event.preventDefault();
      if (!acknowledged || pending || (outcome === 'sent' && !remoteId.trim())) return;
      const data = new FormData(event.currentTarget);
      startTransition(() => recordAction(data));
    }}>
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="postTargetId" value={target.id} />
      <input type="hidden" name="confirmation" value={acknowledged ? `RECORD FIRST COMMENT ${target.id} ${outcome === 'sent' ? 'SENT' : 'NOT SENT'}` : ''} />
      <div className="ui-dialog__header"><div><h2 id={`first-comment-title-${target.id}`}>{t('recordThePlatformCheck')}</h2><p>{t('thisRecordsYourManualCheckTheApp')}</p></div></div>
      <div className="ui-dialog__body">
        <p>{t('theOriginalRequestMayStillCompleteLater')}</p>
        <fieldset className={styles.targetPicker} disabled={pending}><legend>{t('whatDidYouVerify')}</legend>
          <label><input type="radio" name="outcomeChoice" value="not_sent" checked={outcome === 'not_sent'} onChange={() => setOutcome('not_sent')} /> {t('theCommentIsNotPresent')}</label>
          <label><input type="radio" name="outcomeChoice" value="sent" checked={outcome === 'sent'} onChange={() => setOutcome('sent')} /> {t('theCommentIsPresent')}</label>
        </fieldset>
        <input type="hidden" name="outcome" value={outcome} />
        {outcome === 'sent' ? <label className="ui-field" htmlFor={`first-comment-remote-id-${target.id}`}><span>{t('platformCommentID')}</span><input className="ui-input" id={`first-comment-remote-id-${target.id}`} name="remoteId" value={remoteId} onChange={event => setRemoteId(event.currentTarget.value)} required disabled={pending} /></label> : <input type="hidden" name="remoteId" value="" />}
        <label className={styles.confirmCheck}><input type="checkbox" name="acknowledged" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.currentTarget.checked)} /> {t('iCheckedThePlatformOutsideThisApp')}</label>
        {recordState.status === 'error' ? <p className="ui-error" role="alert" data-first-comment-error tabIndex={-1}>{recordState.message ?? t('theOutcomeCouldNotBeRecordedCheck')}</p> : null}
      </div>
      <div className="ui-dialog__actions"><Button type="button" data-first-comment-cancel disabled={pending} onClick={onDismiss}>{t('cancel')}</Button><Button variant="primary" type="submit" disabled={pending || !acknowledged || (outcome === 'sent' && !remoteId.trim())}>{t('recordResult')}</Button></div>
    </form>}
  </ModalDialog>;
}

export async function runSendFirstCommentWithRecovery(previous: FirstCommentActionState, data: FormData, t: PublishingActionText = defaultPublishingActionText): Promise<FirstCommentActionState> {
  const postId = typeof data.get('postId') === 'string' ? String(data.get('postId')) : previous.postId;
  const postTargetId = typeof data.get('postTargetId') === 'string' ? String(data.get('postTargetId')) : previous.postTargetId;
  try { return await sendFirstCommentAction(previous, data); }
  catch (error) {
    if (isActionRedirect(error)) throw error;
    return { status: 'error', postId, postTargetId, state: 'needs_review', message: t('theSendResultIsUnconfirmedCheckThe') };
  }
}

export async function runRecordFirstCommentWithRecovery(previous: FirstCommentActionState, data: FormData, t: PublishingActionText = defaultPublishingActionText): Promise<FirstCommentActionState> {
  const postId = typeof data.get('postId') === 'string' ? String(data.get('postId')) : previous.postId;
  const postTargetId = typeof data.get('postTargetId') === 'string' ? String(data.get('postTargetId')) : previous.postTargetId;
  const submittedOutcome = data.get('outcome');
  const outcome = submittedOutcome === 'sent' || submittedOutcome === 'not_sent' ? submittedOutcome : previous.outcome;
  const submittedId = data.get('remoteId');
  const remoteId = typeof submittedId === 'string' ? submittedId : previous.remoteId;
  try { return await recordFirstCommentOutcomeAction(previous, data); }
  catch (error) {
    if (isActionRedirect(error)) throw error;
    return { status: 'error', postId, postTargetId, state: 'needs_review', outcome, remoteId, message: t('theOutcomeIsUnconfirmedCheckTheCurrent') };
  }
}

function PostEditForm({ post, targets, selected, imageRules, disabled, onPendingChange }: { post: PostRow; targets: TargetChoice[]; selected: Set<string>; imageRules: ImageRules; disabled: boolean; onPendingChange: (pending: boolean) => void }) {
  const t = usePublishingActionText();
  const { catalog, locale } = useComposerCatalog();
  const initialValues: Partial<ComposerValues> = {
    intent: '', mediaJson: JSON.stringify(post.media), destinationFormatsJson: JSON.stringify(Object.fromEntries(post.targets.map(t => [t.target.id, t.formatId ?? post.format]).filter((entry): entry is [string,string] => typeof entry[1] === 'string'))), message: post.message, firstComment: post.firstComment ?? '', firstCommentDelayMinutes: String(post.firstCommentDelayMinutes ?? 0), link: post.link ?? '',
    targetIds: [...selected], scheduleDate: '', scheduleTime: '',
  };
  const [actionState, formAction, pending] = useActionState((previous: PostEditActionState, data: FormData) => runUpdatePostWithRecovery(previous, data, t), { status: 'idle', values: initialValues } satisfies PostEditActionState);
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
    if (!validation.validate(form, postValidationErrors(form, hasOtherContent, t))) { event.preventDefault(); return; }
    if (!attachments.validate()) { event.preventDefault(); focusAlert(form); return; }
    const issue = selectedMediaIssue(formatTargets, attachments.media, link, attachments.items, t, publishingMediaFormatter(catalog, locale));
    if (issue) { event.preventDefault(); attachments.setError(issue); return; }
    const hasPendingUploads = attachments.items.some(item => item.source === 'upload' && item.file);
    if (!hasPendingUploads) { setUploadMessage(''); return; }

    event.preventDefault();
    if (form.dataset.uploading === 'true') return;
    form.dataset.uploading = 'true';
    setUploading(true);
    setUploadMessage(t('uploadingImages'));
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    try {
      if (!await attachments.prepareUploads()) {
        setUploadMessage(t('someImagesCouldNotBeUploadedYour'));
        return;
      }
      setUploadMessage('');
      form.dataset.uploading = 'false';
      flushSync(() => setUploading(false));
      form.requestSubmit(submitter instanceof HTMLElement ? submitter as HTMLButtonElement : undefined);
    } catch {
      setUploadMessage(t('weCouldNotUploadEveryImageYour'));
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
    <fieldset className="ui-field"><legend>{t('postFormats')}</legend><DestinationFormats copyCatalog={catalog} locale={locale} targets={targets} selectedIds={selectedTargets.map(target=>target.id)} values={formatChoices} onChange={(id,value) => setValues(current => ({...current,destinationFormatsJson:JSON.stringify({...readFormatValues(current.destinationFormatsJson),[id]:value})}))} formId={`post-edit-${post.id}`} disabled={disabled || pending || uploading} /></fieldset>
    <fieldset className={styles.formFields}>
      <label htmlFor={`message-${post.id}`}>{t('postText')} <span>{t('optionalWithALinkOrMedia')}</span></label>
      <AutoTextarea id={`message-${post.id}`} name="message" value={values.message ?? post.message} onChange={event => setValue('message', event.currentTarget.value)} rows={4} disabled={disabled || pending || uploading} aria-invalid={Boolean(validation.errors.message)} aria-describedby={validation.errors.message ? `message-error-${post.id}` : undefined} />
      {validation.errors.message && <p id={`message-error-${post.id}`} className={styles.formError} role="alert">{validation.errors.message}</p>}
      <label htmlFor={`comment-${post.id}`}>{t('firstComment')} <span>{t('optional2')}</span></label>
      <AutoTextarea id={`comment-${post.id}`} name="firstComment" value={values.firstComment ?? post.firstComment ?? ''} onChange={event => setValue('firstComment', event.currentTarget.value)} rows={2} disabled={disabled || pending || uploading} />
      <label htmlFor={delayField.id}>{t('waitBeforeTheFirstComment')} <span>{t('minutes0SendsItRightAfterPublication')}</span></label>
      <input name="firstCommentDelayMinutes" type="number" inputMode="numeric" min={0} max={imageRules.maxFirstCommentDelayMinutes} step={1} value={values.firstCommentDelayMinutes ?? String(post.firstCommentDelayMinutes ?? 0)} onChange={event => setValue('firstCommentDelayMinutes', event.currentTarget.value)} disabled={disabled || pending || uploading} {...delayField} />
      <p id={`comment-delay-help-${post.id}`} className={styles.help}>{t('chooseAWholeNumberFrom0To')} {imageRules.maxFirstCommentDelayMinutes.toLocaleString()} {t('minutes')}</p>
      <FieldError {...validation.errorProps('firstCommentDelayMinutes')} />
      <label htmlFor={`link-${post.id}`}>{t('link')} <span>{t('optional2')}</span></label><input id={`link-${post.id}`} name="link" type="url" value={values.link ?? post.link ?? ''} onChange={event => setValue('link', event.currentTarget.value)} disabled={disabled || pending || uploading} aria-invalid={Boolean(validation.errors.link)} aria-describedby={validation.errors.link ? `link-error-${post.id}` : undefined} />
      {validation.errors.link && <p id={`link-error-${post.id}`} className={styles.formError} role="alert">{validation.errors.link}</p>}
      <PostAttachments controller={attachments} disabled={disabled || pending || uploading} />
      <AuthoringMediaPreview controller={attachments} />
      <TargetPicker targets={targets} selected={targetIds} disabled={disabled || pending || uploading} onSelectionChange={next => setValues(current => ({ ...current, targetIds: [...next] }))} />
      {actionState.status === 'error' && <p className={styles.formError} role="alert" data-edit-error tabIndex={-1}>{actionState.message ?? t('thePostCouldNotBeSavedYour')}</p>}
      {uploadMessage && <p className={styles.formError} role="status">{uploadMessage}</p>}
      <Button size="sm" type="submit" disabled={disabled || pending || uploading}>{uploading ? t('uploading') : pending ? t('saving') : t('savePost')}</Button>
    </fieldset>
  </form>;
}

function PostDeleteDialog({ postId, postMessage, hasRemote, onDismiss, onPendingChange }: { postId: string; postMessage: string; hasRemote: boolean; onDismiss: () => void; onPendingChange: (pending: boolean) => void }) {
  const t = usePublishingActionText();
  const [actionState, formAction, pending] = useActionState((previous: PostDeleteActionState, data: FormData) => runDeletePostWithRecovery(previous, data, t), { status: 'idle', deleteRemote: false } satisfies PostDeleteActionState);
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
      <div className="ui-dialog__header"><div><h2 id={`delete-title-${postId}`}>{t('deleteThisPostLocally')}</h2><p>{t('thisPermanentlyRemovesThePostAndIts')}</p></div></div>
      <div className="ui-dialog__body">
        <p><strong>{t('postText')}</strong></p>
        <p className={styles.help} style={{ overflowWrap: 'anywhere', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 3, overflow: 'hidden' }}>{postMessage}</p>
        <p>{hasRemote ? t('chooseWhetherToRequestDeletionOfRecorded') : t('noRemotePostIsRecordedForThis')}</p>
        {hasRemote ? <label className={styles.confirmCheck}><input type="checkbox" name="deleteRemote" checked={deleteRemote} disabled={pending} onChange={event => setDeleteRemote(event.currentTarget.checked)} /> {t('alsoRequestDeletionOfRecordedRemotePosts')}</label> : null}
        {actionState.receipt ? <section aria-label={t('deletionStatus')}>
          <p role={actionState.status === 'error' ? 'alert' : 'status'}><strong>{t('deletionStatus2')}</strong> {t(`deletion_${actionState.receipt.state}`)}. {actionState.message}</p>
          {actionState.receipt.operations.map(operation => <div className={styles.firstCommentRow} key={operation.operationId}>
            <span>{operation.targetName ?? t('destination')}: {deletionOperationLabel(operation.state, operation.remoteConfirmed, t)}</span>
            {['started', 'uncertain'].includes(operation.state) ? <>
              <Button type="button" size="sm" disabled={pending || !acknowledged} onClick={() => submit('record', { operationId: operation.operationId, outcome: 'deleted' })}>{t('recordDeleted')}</Button>
              <Button type="button" size="sm" disabled={pending || !acknowledged} onClick={() => submit('record', { operationId: operation.operationId, outcome: 'not_deleted' })}>{t('recordNotDeleted')}</Button>
            </> : null}
          </div>)}
        </section> : null}
        {actionState.receipt?.operations.some(operation => operation.state === 'started' || operation.state === 'uncertain') ? <div>
          <p>{t('theOriginalRequestMayStillCompleteLater2')}</p>
          <label className={styles.confirmCheck}><input type="checkbox" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.currentTarget.checked)} /> {t('iCheckedThePlatformOutsideThisApp2')}</label>
        </div> : null}
        {actionState.status === 'error' && <p className="ui-error" role="alert" data-dialog-error tabIndex={-1}>{actionState.message ?? t('weCouldNotConfirmWhetherThisPost')}</p>}
      </div>
      <div className="ui-dialog__actions"><Button type="button" data-dialog-cancel disabled={pending} onClick={onDismiss}>{t('close')}</Button><Button type="button" disabled={pending} onClick={() => submit('status')}>{t('checkDeletionStatus')}</Button>{actionState.receipt?.state === 'local_pending' ? <Button variant="danger" type="button" disabled={pending} onClick={() => submit('finish')}>{t('finishLocalRemoval')}</Button> : <Button variant="danger" type="button" disabled={pending || actionState.receipt?.operations.some(operation => operation.state === 'started' || operation.state === 'uncertain')} onClick={() => submit('start')}>{actionState.receipt?.operations.some(operation => operation.state === 'rejected') ? t('newDeletionRequest') : t('deletePost')}</Button>}</div>
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

function deletionOperationLabel(state: string, remoteConfirmed: boolean, t: PublishingActionText = defaultPublishingActionText): string {
  if (remoteConfirmed) return t('remoteDeletionConfirmed');
  switch (state) {
    case 'started': return t('requestStarted');
    case 'uncertain': return t('outcomeUnconfirmed');
    case 'remote_confirmed': return t('remoteDeletionConfirmed');
    case 'completed': return t('localCleanupCompleted');
    case 'rejected': return t('notDeleted');
    default: return t('needsReview');
  }
}

export async function runUpdatePostWithRecovery(previous: PostEditActionState, data: FormData, t: PublishingActionText = defaultPublishingActionText): Promise<PostEditActionState> {
  try { return await updatePostWithRecoveryAction(previous, data); }
  catch (error) {
    if (isActionRedirect(error)) throw error;
    return { status: 'error', message: t('weCouldNotConfirmWhetherThisPost2'), values: valuesFromFormData(data) };
  }
}

export async function runDeletePostWithRecovery(previous: PostDeleteActionState, data: FormData, t: PublishingActionText = defaultPublishingActionText): Promise<PostDeleteActionState> {
  const deleteRemote = data.get('deleteRemote') === 'on';
  try {
    const result = await deletePostWithRecoveryAction(previous, data);
    if (result.status === 'error' && !result.receipt && previous.receipt) return { ...result, deleteRemote, receipt: previous.receipt };
    return result;
  }
  catch (error) {
    if (isActionRedirect(error)) throw error;
    const operationId = data.get('operationId');
    return { status: 'error', message: t('theDeletionResultIsUnconfirmedCheckDeletion'), deleteRemote, ...(previous.receipt ? { receipt: previous.receipt } : {}), ...(typeof operationId === 'string' ? { operationId } : {}) };
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
  const t = usePublishingActionText();
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
      <label>{t('scheduleYourLocalTime')} <input {...validation.fieldProps('localScheduledAt')} type="datetime-local" name="localScheduledAt" required/></label>
      <FieldError {...validation.errorProps('localScheduledAt')} /><input type="hidden" name="scheduledAt"/>
      <button className="ui-button ui-button--secondary ui-button--sm" type="submit">{t('addToQueue')}</button>
    </fieldset>
  </form>;
}

function TargetPicker({ targets, selected = new Set<string>(), onSelectionChange, disabled = false }: { targets: TargetChoice[]; selected?: Set<string>; onSelectionChange?: (selected: Set<string>) => void; disabled?: boolean }) {
  const t = usePublishingActionText();
  const supported = targets.filter(target => target.canPublish);
  return <fieldset className={styles.targetPicker}>
    <legend>{t('destinations')} <span>{t('optional2')}</span></legend>
    {supported.length ? supported.map(target => <label key={target.id}>
      <input type="checkbox" name="targetIds" value={target.id} disabled={disabled} {...(onSelectionChange ? { checked: selected.has(target.id), onChange: (event: ChangeEvent<HTMLInputElement>) => { const next = new Set(selected); if (event.currentTarget.checked) next.add(target.id); else next.delete(target.id); onSelectionChange(next); } } : { defaultChecked: selected.has(target.id) })} />
      <span>{target.name}</span>
    </label>) : <p>{t('noEnabledDestinationsCanPublishRightNow')}</p>}
    <small>{t('onlyEnabledDestinationsThatSupportPublishingAre')}</small>
  </fieldset>;
}

function RetryFailedButton({ postId, count, copy, disabled }: { postId: string; count: number; copy: { retryOne: string; retryOneHelp: (n: number) => string; cancel: string; confirm: string }; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return <form ref={formRef} noValidate action={publishPostAction}>
    <input type="hidden" name="postId" value={postId} />
    <input type="hidden" name="retryOnly" value="1" />
    <button className="ui-button ui-button--secondary ui-button--sm" type="button" disabled={disabled} onClick={() => setOpen(true)}>{copy.retryOne}</button>
    {open ? <ModalDialog className="ui-dialog" labelledBy={`retry-title-${postId}`} describedBy={`retry-help-${postId}`} onDismiss={() => setOpen(false)}>
      <h2 id={`retry-title-${postId}`}>{copy.retryOne}</h2>
      <p id={`retry-help-${postId}`}>{copy.retryOneHelp(count)}</p>
      <div className="ui-dialog__actions">
        <button className="ui-button ui-button--secondary" type="button" data-dialog-cancel onClick={() => setOpen(false)}>{copy.cancel}</button>
        <button className="ui-button ui-button--primary" type="button" onClick={() => { setOpen(false); formRef.current?.requestSubmit(); }}>{copy.confirm}</button>
      </div>
    </ModalDialog> : null}
  </form>;
}
