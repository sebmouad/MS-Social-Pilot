'use client';

import { usePreserveFormState } from '@/components/usePreserveFormState';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Button } from '@/components';
import { Dialog } from '@/components/Dialog';
import { PostPreview } from '@/components/PostPreview';
import { SidebarDock } from '@/components/SidebarDock';
import { AuthoringMediaPreview, PostAttachments, usePostAttachments, type PostMediaItem } from '@/modules/publishing/components/PostAttachments';
import { publishingMediaIssue } from '@/modules/publishing/media-support';
import { DestinationFormats, effectiveDestinationFormat } from '@/modules/publishing/components/DestinationFormats';
import type { PublishingFormatDescriptor, PublishingMediaSupport } from '@/platforms/types';
import { useActionState, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createPostWithRecoveryAction, type ComposerActionState } from '../posts/actions';
import styles from './PostComposer.module.css';

type LocalImageUpload = { maxBytes: number; mimeTypes: readonly string[] };
type TargetChoice = {
  id: string; name: string; type: string; provider: string | null; canPublish: boolean;
  publishingMedia?: PublishingMediaSupport;
  publishingFormats?: readonly PublishingFormatDescriptor[];
  defaultPublishingFormatId?: string;
  localImageUpload?: LocalImageUpload;
};
type ImageRules = { allowedMimeTypes: string[]; maxUploadBytes: number; maxAltCharacters: number; maxMessageCharacters: number; maxMedia: number };
type Schedule = { date: string; time: string; timeZone: string };
type ComposerTemplate = { id: string; name: string; category: string; body: string; hashtags: string; firstComment: string; labelId: string | null };

const INITIAL_STATE: ComposerActionState = { status: 'idle', values: {} };
const FORM_ID = 'post-composer-form';
const ALL_MEDIA_KINDS = ['image', 'video'] as const;

async function saveWithTransportRecovery(previous: ComposerActionState, data: FormData): Promise<ComposerActionState> {
  try { return await createPostWithRecoveryAction(previous, data); }
  catch (error) {
    // Next redirects are framework control flow and must reach its action router.
    if (error && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) throw error;
    return { status: 'error', saveUnconfirmed: true, message: 'We could not confirm whether this post was saved. Check Posts before retrying.', values: previous.values };
  }
}

function initialMedia(value: unknown): PostMediaItem[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PostMediaItem => Boolean(item && typeof item === 'object'
      && ((item as PostMediaItem).kind === 'image' || (item as PostMediaItem).kind === 'video')
      && typeof (item as PostMediaItem).url === 'string'));
  } catch { return []; }
}

function parseFormats(value: unknown): Record<string, string> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { return {}; }
}

/** The chosen format's media rules when its module declares them; otherwise the legacy destination metadata. */
function mediaSupport(target: TargetChoice, formats: Record<string, string>): PublishingMediaSupport | undefined {
  const id = effectiveDestinationFormat(target, formats);
  return target.publishingFormats?.find(format => format.id === id)?.media ?? target.publishingMedia;
}

function allowedKinds(targets: TargetChoice[], formats: Record<string, string>) {
  if (!targets.length) return [...ALL_MEDIA_KINDS];
  return ALL_MEDIA_KINDS.filter(kind => targets.every(target => mediaSupport(target, formats)?.kinds.includes(kind)));
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
  const files = items.filter(item => item.source === 'upload' && item.file);
  for (const target of targets) {
    for (const item of files) {
      const file = item.file!;
      const upload = target.localImageUpload;
      if (!upload) return `${target.name} does not currently support local image uploads. Remove the uploaded image or choose another destination.`;
      if (!upload.mimeTypes.includes(file.type)) return `${target.name} does not accept ${file.type || 'this image format'}. Choose another image or destination.`;
      if (file.size > upload.maxBytes) return `${target.name} accepts images up to ${Math.ceil(upload.maxBytes / 1048576)} MB. Choose another image or destination.`;
    }
  }
  return null;
}

function selectedMediaIssue(targets: TargetChoice[], formats: Record<string, string>, media: readonly PostMediaItem[], link: string, items: ReturnType<typeof usePostAttachments>['items']) {
  if (!targets.length) return null;
  const completeMedia = items.map(item => ({ kind: item.kind, url: item.url || 'media:pending', ...(item.altText === undefined ? {} : { altText: item.altText }) }));
  for (const target of targets) {
    const issue = publishingMediaIssue(mediaSupport(target, formats),completeMedia.length ? completeMedia : media, link);
    if (issue) return `${target.name}: ${issue}`;
  }
  return localUploadIssue(targets, items);
}

export function PostComposer({ targets, templates = [], imageRules, schedule, authorName, createdAt, createdAtDisplay }: { targets: TargetChoice[]; templates?: ComposerTemplate[]; imageRules: ImageRules; schedule: Schedule; authorName: string; createdAt: Date; createdAtDisplay: string }) {
  const router = useRouter();
  const navigated = useRef<ComposerActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  usePreserveFormState(formRef);
  const [state, formAction, pending] = useActionState(saveWithTransportRecovery, INITIAL_STATE);
  const saved = state.status === 'success';
  const initial = state.values;
  const [message, setMessage] = useState(initial.message ?? '');
  const [firstComment, setFirstComment] = useState(initial.firstComment ?? '');
  const [labelId, setLabelId] = useState(initial.labelId ?? '');
  const [link, setLink] = useState(initial.link ?? '');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(initial.targetIds ?? []);
  const [formatChoices, setFormatChoices] = useState<Record<string, string>>(() => parseFormats(initial.destinationFormatsJson));
  const [scheduleDate, setScheduleDate] = useState(initial.scheduleDate ?? schedule.date);
  const [scheduleTime, setScheduleTime] = useState(initial.scheduleTime ?? schedule.time);
  const [mode, setMode] = useState<'draft' | 'schedule'>((initial.intent as 'draft' | 'schedule') ?? 'draft');
  const [localError, setLocalError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateToApply, setTemplateToApply] = useState<ComposerTemplate | null>(null);
  const [uploading, setUploading] = useState(false);
  const submitGuard = useRef<'ready' | 'uploading' | 'submitting'>('ready');
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const selected = useMemo(() => targets.filter(target => selectedTargets.includes(target.id) && target.canPublish), [targets, selectedTargets]);
  const uploadRules = localUploadRules(selected, imageRules);
  const destinationFormatsJson = useMemo(() => {
    const out: Record<string, string> = Object.create(null);
    for (const target of selected) { const value = effectiveDestinationFormat(target, formatChoices); if (value !== undefined) out[target.id] = value; }
    return JSON.stringify(out);
  }, [selected, formatChoices]);
  const attachments = usePostAttachments({
    initialMedia: initialMedia(initial.mediaJson),
    maxMedia: imageRules.maxMedia,
    maxAltCharacters: imageRules.maxAltCharacters,
    allowedMimeTypes: uploadRules.allowedMimeTypes,
    maxUploadBytes: uploadRules.maxUploadBytes,
    allowedKinds: allowedKinds(selected, formatChoices),
    allowMixedKinds: !selected.length || selected.every(target => mediaSupport(target, formatChoices)?.mixedKinds === true),
  });
  const templateContentExists = Boolean(message.trim() || firstComment.trim() || link.trim() || attachments.items.length);
  const visibleTemplates = templates.filter(template => `${template.name} ${template.category} ${template.body}`.toLocaleLowerCase().includes(templateSearch.trim().toLocaleLowerCase()));
  function chooseTemplate(template: ComposerTemplate) {
    setTemplateChooserOpen(false);
    setTemplateSearch('');
    if (templateContentExists) setTemplateToApply(template);
    else applyTemplate(template);
  }
  function applyTemplate(template: ComposerTemplate) {
    const text = [template.body, template.hashtags].map(value => value.trim()).filter(Boolean).join('\n\n');
    setMessage(text);
    setFirstComment(template.firstComment);
    setLabelId(template.labelId ?? '');
    setTemplateToApply(null);
  }

  useEffect(() => {
    if (state.status === 'success' && state.destination && navigated.current !== state) {
      navigated.current = state;
      router.push(state.destination);
    }
  }, [state, router]);
  useEffect(() => {
    if (state.status === 'error') {
      submitGuard.current = 'ready';
      setLocalError('');
    }
  }, [state]);
  useEffect(() => {
    if (localError || state.status === 'error' || state.status === 'success') feedbackRef.current?.focus();
  }, [localError, state]);

  const previewPost = useMemo(() => ({
    id: 'composer-preview', authorId: 'preview', message, firstComment: firstComment || null,
    link: link || null,
    media: attachments.media,
    status: 'draft', scheduledAt: null, publishedAt: null, createdAt, displayTime: createdAtDisplay,
    targets: selected.map(target => ({ status: 'pending', remotePostId: null, remoteUrl: null, target: { id: target.id, type: target.type, name: target.name, pictureUrl: null } })),
  }), [message, firstComment, link, attachments.media, createdAt, createdAtDisplay, selected]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === 'schedule' ? 'schedule' : 'draft';
    setMode(intent);
    setLocalError('');
    setUploadMessage('');
    const hasContent = Boolean(message.trim() || link.trim() || attachments.items.some(item => item.file || item.url.trim()));
    if (!hasContent) {
      event.preventDefault(); setLocalError('Add post text, a link, or media before saving. A first comment alone is not a post.');
      form.elements.namedItem('message') instanceof HTMLElement && (form.elements.namedItem('message') as HTMLElement).focus(); return;
    }
    if (message.length > imageRules.maxMessageCharacters) {
      event.preventDefault(); setLocalError(`Post text must be ${imageRules.maxMessageCharacters.toLocaleString()} characters or fewer.`); return;
    }
    if (link.trim()) {
      let valid = false;
      try { const parsed = new URL(link); valid = parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { /* shown as a field error */ }
      if (!valid) { event.preventDefault(); setLocalError('Enter a complete HTTPS URL without a username or password.'); document.getElementById('composer-link')?.focus(); return; }
    }
    if (intent === 'schedule' && (!scheduleDate || !scheduleTime || !selected.length)) {
      event.preventDefault(); setLocalError(!selected.length ? 'Choose at least one destination before scheduling.' : 'Choose a date and time before scheduling.'); return;
    }
    if (!attachments.validate()) { event.preventDefault(); setLocalError('Fix the attachment issues before saving.'); form.querySelector<HTMLElement>('[role="alert"]')?.focus(); return; }

    const supportIssue = selectedMediaIssue(selected, formatChoices, attachments.media, link, attachments.items);
    if (supportIssue) { event.preventDefault(); attachments.setError(supportIssue); setLocalError('Review the destination attachment requirements before saving.'); form.querySelector<HTMLElement>('[role="alert"]')?.focus(); return; }

    const hasPendingUploads = attachments.items.some(item => item.source === 'upload' && item.file);
    if (hasPendingUploads) {
      event.preventDefault();
      if (submitGuard.current !== 'ready') return;
      submitGuard.current = 'uploading';
      setUploading(true);
      setUploadMessage('Uploading images…');
      try {
        if (!await attachments.prepareUploads()) {
          setUploadMessage('Some images could not be uploaded. Your order and descriptions are still here; fix the marked items and retry.');
          return;
        }
        submitGuard.current = 'ready';
        flushSync(() => { setUploadMessage(''); setUploading(false); });
        form.requestSubmit(submitter ?? undefined);
      } catch {
        setUploadMessage('We could not upload every image. Your post details are still here; try again.');
      } finally {
        setUploading(false);
        if (submitGuard.current === 'uploading') submitGuard.current = 'ready';
      }
      return;
    }
    if (submitGuard.current !== 'ready') { event.preventDefault(); return; }
    submitGuard.current = 'submitting';
  }

  return <div className={styles.composerLayout}>
    <form id={FORM_ID} ref={formRef} action={formAction} onSubmit={onSubmit} className={styles.form} noValidate>
      {saved && <p ref={feedbackRef} tabIndex={-1} className={styles.uploadNotice} role="status">Post saved. Opening Posts… {state.destination && <a href={state.destination}>View saved posts</a>}</p>}
      {localError && <p ref={feedbackRef} className={styles.error} role="alert" tabIndex={-1}>{localError}</p>}
      {state.status === 'error' && <p ref={feedbackRef} className={styles.error} role="alert" data-composer-error tabIndex={-1}>{state.message} Your post details are still here.{state.saveUnconfirmed ? <> <a href="/publishing/posts" target="_blank" rel="noopener noreferrer">Check Posts in a new tab</a>.</> : ' You can retry.'}</p>}
      {uploadMessage && <p className={styles.uploadNotice} role="status">{uploadMessage}</p>}
      <label htmlFor="composer-message">Post text <span>(optional with a link or media)</span></label>
      <AutoTextarea id="composer-message" name="message" disabled={saved} value={message} onChange={event => setMessage(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={7} placeholder="Write a post for your team…" aria-describedby="composer-message-count" />
      <div className={styles.fieldMeta} id="composer-message-count">{message.length.toLocaleString()} / {imageRules.maxMessageCharacters.toLocaleString()}</div>
      <label htmlFor="composer-first-comment">First comment <span>(optional)</span></label>
      <AutoTextarea id="composer-first-comment" name="firstComment" disabled={saved} value={firstComment} onChange={event => setFirstComment(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={3} placeholder="Add a link or follow-up as the first comment…" />
      <input type="hidden" name="labelId" value={labelId} />
      <input type="hidden" name="destinationFormatsJson" value={destinationFormatsJson} />

      <fieldset className={styles.attachments} disabled={uploading || pending || saved}>
        <legend>Attachments <span>(optional)</span></legend>
        <label htmlFor="composer-link">Link <span>(optional)</span></label>
        <input id="composer-link" name="link" type="url" value={link} onChange={event => setLink(event.currentTarget.value)} placeholder="https://example.com" />
        <PostAttachments controller={attachments} disabled={uploading || pending || saved} />
        <small>Attachment support depends on the selected destinations.</small>
      </fieldset>
    </form>

    <section className={styles.previewPanel} aria-labelledby="composer-preview-title">
      <div className={styles.previewHeading}><h2 id="composer-preview-title">Preview</h2><span>Neutral preview</span></div>
      <div className={styles.unsavedLabel}>{saved ? 'Saved post preview' : 'Unsaved preview'} · no destination response is available yet</div>
      <PostPreview post={previewPost} authorName={authorName || 'Your team'} timeZone={schedule.timeZone} variant="card" mediaOverride={<AuthoringMediaPreview controller={attachments} />} />
      {mode === 'schedule' && scheduleDate && scheduleTime && <p className={styles.schedulePreview}>Will schedule for {scheduleDate} at {scheduleTime} ({schedule.timeZone.replaceAll('_', ' ')}).</p>}
    </section>

    <SidebarDock>
      <aside className={styles.sidebarControls} aria-label="Post destinations and timing">
        {templates.length > 0 && <Button type="button" variant="secondary" disabled={pending || uploading || saved} onClick={() => setTemplateChooserOpen(true)}>Choose template</Button>}
        <div className={styles.actions}>
          <Button form={FORM_ID} type="submit" name="intent" value="draft" disabled={pending || uploading || saved} onClick={() => setMode('draft')}>{uploading ? 'Uploading…' : saved ? 'Opening…' : pending ? 'Saving…' : 'Save draft'}</Button>
          <Button form={FORM_ID} type="submit" name="intent" value="schedule" variant="primary" disabled={pending || uploading || saved} onClick={() => setMode('schedule')}>{uploading ? 'Uploading…' : saved ? 'Opening…' : pending ? 'Saving…' : 'Schedule post'}</Button>
        </div>
        <fieldset className={styles.destinationList} disabled={pending || uploading || saved}>
          <legend>Destinations</legend>
          {targets.filter(target => target.canPublish).length ? targets.filter(target => target.canPublish).map(target => <label key={target.id}>
            <input form={FORM_ID} type="checkbox" name="targetIds" value={target.id} checked={selectedTargets.includes(target.id)} onChange={event => { const checked = event.currentTarget.checked; setSelectedTargets(current => checked ? [...current, target.id] : current.filter(id => id !== target.id)); }} />
            <span>{target.name}</span>
          </label>) : <p>No destinations are ready to publish right now.</p>}
          <small>Drafts can be saved without a destination. Scheduling needs at least one.</small>
        </fieldset>
        {selected.some(target => target.publishingFormats?.length) && <fieldset className={styles.destinationList} disabled={pending || uploading || saved}>
          <legend>Formats</legend>
          <DestinationFormats targets={targets} selectedIds={selected.map(target => target.id)} values={formatChoices} formId={FORM_ID} disabled={pending || uploading || saved} onChange={(id, value) => setFormatChoices(current => ({ ...current, [id]: value }))} />
        </fieldset>}
        <fieldset className={styles.scheduleFields} disabled={pending || uploading || saved}>
          <legend>Schedule</legend>
          <p>Times use {schedule.timeZone.replaceAll('_', ' ')}.</p>
          <label htmlFor="composer-date">Date</label><input form={FORM_ID} id="composer-date" type="date" name="scheduleDate" value={scheduleDate} onChange={event => setScheduleDate(event.currentTarget.value)} />
          <label htmlFor="composer-time">Time</label><input form={FORM_ID} id="composer-time" type="time" name="scheduleTime" value={scheduleTime} onChange={event => setScheduleTime(event.currentTarget.value)} />
        </fieldset>
      </aside>
    </SidebarDock>
    <Dialog open={templateChooserOpen} title="Choose a post template" description="This copies saved message text and first comment into the current composer. It does not create or publish a post." onClose={() => setTemplateChooserOpen(false)} actions={<Button data-dialog-cancel onClick={() => setTemplateChooserOpen(false)}>Close</Button>}>
      <label className={styles.templateSearch}>Search templates<input type="search" value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} maxLength={120} /></label>
      {visibleTemplates.length ? <ul className={styles.templateList}>{visibleTemplates.map(template => <li key={template.id}><div><strong>{template.name}</strong><span>{template.category || 'Uncategorized'}</span><p>{template.body}{template.hashtags ? `\n${template.hashtags}` : ''}</p>{template.labelId && <small>Using this template will apply its workspace label to the new post.</small>}</div><Button type="button" size="sm" onClick={() => chooseTemplate(template)}>Use template</Button></li>)}</ul> : <p>No templates match this search.</p>}
    </Dialog>
    <Dialog open={Boolean(templateToApply)} title="Replace the current draft text?" description="The template will replace the current message and first comment. Your selected destinations, attachments, link and schedule stay as they are." onClose={() => setTemplateToApply(null)} actions={<><Button data-dialog-cancel onClick={() => setTemplateToApply(null)}>Keep current draft</Button><Button variant="primary" onClick={() => templateToApply && applyTemplate(templateToApply)}>Replace message and first comment</Button></>}>
      <p><strong>{templateToApply?.name}</strong></p><p>{templateToApply?.body}</p>{templateToApply?.hashtags && <p>{templateToApply.hashtags}</p>}
    </Dialog>
  </div>;
}
