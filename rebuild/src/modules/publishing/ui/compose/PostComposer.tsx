'use client';
import { BestTimeSuggestions } from './BestTimeSuggestions';
import { GroupShortcut } from '@/modules/settings/ui/profiles/GroupShortcut';
import { profileChannelName, type ProfileDirectory } from '@/modules/settings/channel-profiles/contracts';

import { usePreserveFormState } from '@/components/usePreserveFormState';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Badge, Button, Field, RadioCards, Select, TextInput } from '@/components';
import { Dialog } from '@/components/Dialog';
import { Avatar } from '@/modules/publishing/ui/kit/kit';
import { composerCopy } from './composer-copy';
import { PostPreview } from '@/components/PostPreview';
import { SidebarDock } from '@/components/SidebarDock';
import { AuthoringMediaPreview, PostAttachments, usePostAttachments, type PostMediaItem } from '@/modules/publishing/components/PostAttachments';
import { publishingMediaIssue } from '@/modules/publishing/media-support';
import { DestinationFormats, effectiveDestinationFormat } from '@/modules/publishing/components/DestinationFormats';
import type { PublishingFormatDescriptor, PublishingMediaSupport } from '@/platforms/types';
import { useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createPostWithRecoveryAction } from '@/modules/publishing/ui/posts/actions';
import { crowdedDestinationPlatforms } from '@/modules/settings/workspace-operations';
import { workspaceOperationsCopy } from '@/modules/settings/workspace-operations-copy';
import { AiAssist } from '@/modules/ai/components/AiAssist';
import type { AiStatus } from '@/modules/ai/ai';
import { autosaveDraftAction, previewQueueAction, saveQueueComposerAction, type QueueComposerState as ComposerActionState, type QueuePreviewState } from './queue-actions';
import { fill, queueCopy } from './queue-copy';
import { holdsRemotely, leadLabel, remoteScheduleCopy } from './remote-copy';
import { formatDate } from '@/modules/publishing/ui/publishing-ui';
import styles from './PostComposer.module.css';

type LocalImageUpload = { maxBytes: number; mimeTypes: readonly string[] };
type TargetChoice = {
  id: string; name: string; type: string; provider: string | null; canPublish: boolean;
  /** The installed platform module's customer-facing name; null when unknown. */
  platformName?: string | null;
  publishingMedia?: PublishingMediaSupport;
  publishingFormats?: readonly PublishingFormatDescriptor[];
  defaultPublishingFormatId?: string;
  localImageUpload?: LocalImageUpload;
};
type ImageRules = { allowedMimeTypes: string[]; maxUploadBytes: number; maxAltCharacters: number; maxMessageCharacters: number; maxMedia: number };
type Schedule = { date: string; time: string; timeZone: string };
type ComposerTemplate = { id: string; name: string; category: string; body: string; hashtags: string; firstComment: string; firstCommentDelayMinutes: number; labelId: string | null };

const INITIAL_STATE: ComposerActionState = { status: 'idle', values: {} };
const FORM_ID = 'post-composer-form';
const ALL_MEDIA_KINDS = ['image', 'video'] as const;

async function saveWithTransportRecovery(previous: ComposerActionState, data: FormData): Promise<ComposerActionState> {
  try { return await (data.get('intent') === 'queue' || previous.values.draftPostId || data.get('draftPostId') ? saveQueueComposerAction(previous, data) : createPostWithRecoveryAction(previous, data)); }
  catch (error) {
    // Next redirects are framework control flow and must reach its action router.
    if (error && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) throw error;
    return { status: 'error', saveUnconfirmed: true, message: 'We could not confirm whether this post was saved. Check Posts before retrying.', values: previous.values };
  }
}

/** One numbered stage of the authoring flow: destinations, content, media, first comment, scheduling. */
function Step({ n, title, help, children }: { n: number; title: string; help?: string; children: ReactNode }) {
  const id = useId();
  return <section className={styles.step} aria-labelledby={id}>
    <header className={styles.stepHead}><span className={styles.stepNumber} aria-hidden="true">{n}</span><h2 id={id}>{title}</h2></header>
    {help ? <p className={styles.fieldHelp}>{help}</p> : null}
    {children}
  </section>;
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

function parseModes(value: unknown): Record<string, 'application' | 'remote'> {
  const out: Record<string, 'application' | 'remote'> = {};
  for (const [id, mode] of Object.entries(parseFormats(value))) if (mode === 'application' || mode === 'remote') out[id] = mode;
  return out;
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

export function PostComposer({ profiles, targets, templates = [], imageRules, schedule, authorName, createdAt, createdAtDisplay, maxFirstCommentDelayMinutes, spacingGapMinutes = 0, aiStatus, aiLocale = 'en', queueAvailable = false, remoteScheduling, autosaveSeconds = 0 }: { autosaveSeconds?: number; remoteScheduling?: { offered: boolean; defaultMode: 'application' | 'remote' }; profiles?: ProfileDirectory; queueAvailable?: boolean; aiStatus?: AiStatus; aiLocale?: 'en' | 'fr'; targets: TargetChoice[]; templates?: ComposerTemplate[]; imageRules: ImageRules; schedule: Schedule; authorName: string; createdAt: Date; createdAtDisplay: string; maxFirstCommentDelayMinutes: number; spacingGapMinutes?: number }) {
  const router = useRouter();
  const navigated = useRef<ComposerActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  usePreserveFormState(formRef);
  const [state, formAction, pending] = useActionState(saveWithTransportRecovery, INITIAL_STATE);
  const saved = state.status === 'success';
  const initial = state.values;
  const [message, setMessage] = useState(initial.message ?? '');
  const [firstComment, setFirstComment] = useState(initial.firstComment ?? '');
  const [firstCommentDelayMinutes, setFirstCommentDelayMinutes] = useState(initial.firstCommentDelayMinutes ?? '0');
  const [firstCommentDelayError, setFirstCommentDelayError] = useState('');
  const [labelId, setLabelId] = useState(initial.labelId ?? '');
  const [link, setLink] = useState(initial.link ?? '');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(initial.targetIds ?? []);
  const [formatChoices, setFormatChoices] = useState<Record<string, string>>(() => parseFormats(initial.destinationFormatsJson));
  const [scheduleDate, setScheduleDate] = useState(initial.scheduleDate ?? schedule.date);
  const [scheduleTime, setScheduleTime] = useState(initial.scheduleTime ?? schedule.time);
  const [mode, setMode] = useState<'draft' | 'schedule' | 'queue'>((initial.intent as 'draft' | 'schedule' | 'queue') ?? 'draft');
  const [scheduleMode, setScheduleMode] = useState<'application' | 'remote'>(initial.scheduleMode === 'remote' || initial.scheduleMode === 'application' ? initial.scheduleMode : remoteScheduling?.defaultMode ?? 'application');
  const [destinationModes, setDestinationModes] = useState<Record<string, 'application' | 'remote'>>(() => parseModes(initial.destinationScheduleModesJson));
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [previewSelection, setPreviewSelection] = useState('');
  const [queuePreview, setQueuePreview] = useState<QueuePreviewState | 'loading' | null>(null);
  const copy = queueCopy[aiLocale];
  const [localError, setLocalError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateToApply, setTemplateToApply] = useState<ComposerTemplate | null>(null);
  const [uploading, setUploading] = useState(false);
  const submitGuard = useRef<'ready' | 'uploading' | 'submitting'>('ready');
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const text = composerCopy[aiLocale];
  // Background draft saving: the first save creates the draft, later saves update it, and a manual save reuses its id.
  const [draftPostId, setDraftPostId] = useState(initial.draftPostId ?? '');
  const [autosave, setAutosave] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; at?: string }>({ status: 'idle' });
  const autosaveInFlight = useRef<Promise<unknown> | null>(null);
  const lastAutosaved = useRef('');
  const draftIdRef = useRef(initial.draftPostId ?? '');
  const selected = useMemo(() => targets.filter(target => selectedTargets.includes(target.id) && target.canPublish), [targets, selectedTargets]);
  // The choice appears only when a selected destination's own module declares it can hold a scheduled post.
  const holdCopy = remoteScheduleCopy[aiLocale];
  const heldFormat = (target: TargetChoice) => target.publishingFormats?.find(format => format.id === effectiveDestinationFormat(target, formatChoices));
  const holdable = selected.filter(target => holdsRemotely(heldFormat(target)));
  const appOnly = selected.filter(target => !holdsRemotely(heldFormat(target)));
  const holdablePlatforms = [...new Set(holdable.flatMap(target => target.platformName ? [target.platformName] : []))].join(' + ');
  const holdLeads = holdable.map(target => heldFormat(target)!.scheduling.nativeLeadSeconds!);
  const holdWindow = { min: leadLabel(Math.max(0, ...holdLeads.map(lead => lead.min)), aiLocale), max: leadLabel(Math.min(...holdLeads.map(lead => lead.max)), aiLocale) };
  const uploadRules = localUploadRules(selected, imageRules);
  const crowded = crowdedDestinationPlatforms(spacingGapMinutes, selected.map(target => target.provider)).length > 0;
  // Only destinations that can hold a post on their platform may override the choice; others always stay with the app.
  const destinationScheduleModesJson = useMemo(() => {
    const out: Record<string, 'application' | 'remote'> = Object.create(null);
    if (remoteScheduling?.offered) for (const target of holdable) { const value = destinationModes[target.id]; if (value) out[target.id] = value; }
    return JSON.stringify(out);
  }, [holdable, destinationModes, remoteScheduling?.offered]);
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
    setFirstCommentDelayMinutes(String(template.firstCommentDelayMinutes));
    setLabelId(template.labelId ?? '');
    setTemplateToApply(null);
  }

  const pendingFiles = attachments.items.some(item => item.source === 'upload' && item.file);
  const autosaveSignature = JSON.stringify([message, firstComment, firstCommentDelayMinutes, labelId, link, selectedTargets, formatChoices, attachments.media]);
  useEffect(() => {
    if (!autosaveSeconds || saved || pending || uploading || pendingFiles || submitGuard.current !== 'ready') return;
    if (autosaveSignature === lastAutosaved.current || (!message.trim() && !link.trim() && !attachments.media.length)) return;
    const delay = firstCommentDelayMinutes === '' ? 0 : Number(firstCommentDelayMinutes);
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > maxFirstCommentDelayMinutes) return;
    const timer = setTimeout(() => {
      const data = new FormData();
      data.set('message', message); data.set('firstComment', firstComment); data.set('firstCommentDelayMinutes', firstCommentDelayMinutes);
      data.set('labelId', labelId); data.set('link', link); data.set('mediaJson', JSON.stringify(attachments.media)); data.set('destinationFormatsJson', destinationFormatsJson);
      for (const id of selected.map(target => target.id)) data.append('targetIds', id);
      setAutosave({ status: 'saving' });
      const run = autosaveDraftAction(draftPostId || null, data).then(result => {
        if (result.status === 'saved') {
          lastAutosaved.current = autosaveSignature;
          draftIdRef.current = result.draftPostId;
          setDraftPostId(result.draftPostId);
          setAutosave({ status: 'saved', at: new Intl.DateTimeFormat(aiLocale, { timeZone: schedule.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(result.savedAt)) });
        } else setAutosave(result.status === 'error' ? { status: 'error' } : { status: 'idle' });
      }, () => setAutosave({ status: 'error' })).finally(() => { if (autosaveInFlight.current === run) autosaveInFlight.current = null; });
      autosaveInFlight.current = run;
    }, autosaveSeconds * 1000);
    return () => clearTimeout(timer);
  }, [autosaveSeconds, autosaveSignature, saved, pending, uploading, pendingFiles, message, firstComment, firstCommentDelayMinutes, labelId, link, attachments.media, destinationFormatsJson, selected, draftPostId, maxFirstCommentDelayMinutes, aiLocale, schedule.timeZone]);

  // The chosen queue time is shown before saving. A save that placed (or failed to place) a post changes what is free, so it refreshes too.
  const selectedKey = JSON.stringify(selected.map(target => target.id));
  useEffect(() => {
    if (!queueAvailable || selectedKey === '[]') { setQueuePreview(null); return; }
    let current = true;
    setQueuePreview('loading');
    const timer = setTimeout(() => {
      previewQueueAction(JSON.parse(selectedKey)).then(
        result => { if (current) { setPreviewSelection(selectedKey); setQueuePreview(result); } },
        () => { if (current) { setPreviewSelection(selectedKey); setQueuePreview({ status: 'error', message: queueCopy[aiLocale].unavailable }); } },
      );
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [queueAvailable, selectedKey, aiLocale, state, previewRefresh]);
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
    // A background save still in flight must finish first so the manual save reuses its draft instead of creating a second one.
    if (autosaveInFlight.current) {
      event.preventDefault();
      await autosaveInFlight.current;
      flushSync(() => setDraftPostId(draftIdRef.current));
      form.requestSubmit(submitter ?? undefined);
      return;
    }
    const intent = submitter?.value === 'schedule' ? 'schedule' : submitter?.value === 'queue' && queueAvailable ? 'queue' : 'draft';
    setMode(intent);
    setLocalError('');
    setUploadMessage('');
    const hasContent = Boolean(message.trim() || link.trim() || attachments.items.some(item => item.file || item.url.trim()));
    if (!hasContent) {
      event.preventDefault(); setLocalError('Add post text, a link, or media before saving. A first comment alone is not a post.');
      form.elements.namedItem('message') instanceof HTMLElement && (form.elements.namedItem('message') as HTMLElement).focus(); return;
    }
    const delayValue = firstCommentDelayMinutes === '' ? 0 : Number(firstCommentDelayMinutes);
    if (!Number.isSafeInteger(delayValue) || delayValue < 0 || delayValue > maxFirstCommentDelayMinutes) {
      event.preventDefault();
      setFirstCommentDelayError(`Choose a whole number from 0 to ${maxFirstCommentDelayMinutes.toLocaleString()} minutes.`);
      form.querySelector<HTMLInputElement>('#composer-first-comment-delay')?.focus();
      return;
    }
    setFirstCommentDelayError('');
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
    if (intent === 'queue' && (!selected.length || !queuePreview || typeof queuePreview !== 'object' || queuePreview.status !== 'ready' || previewSelection !== selectedKey)) { event.preventDefault(); setLocalError(!selected.length ? copy.needDestination : copy.unavailable); return; }
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
      {saved && <p ref={feedbackRef} tabIndex={-1} className={styles.uploadNotice} role="status">{state.queued ? fill(state.queued.status === 'pending_approval' ? copy.addedApproval : copy.added, { time: formatDate(new Date(state.queued.scheduledAt), schedule.timeZone) }) : 'Post saved.'} {copy.opening} {state.destination && <a href={state.destination}>{copy.viewSaved}</a>}</p>}
      {localError && <p ref={feedbackRef} className={styles.error} role="alert" tabIndex={-1}>{localError}</p>}
      {state.status === 'error' && <p ref={feedbackRef} className={styles.error} role="alert" data-composer-error tabIndex={-1}>{state.message} {copy.retained}{state.saveUnconfirmed ? <> <a href="/publishing/posts" target="_blank" rel="noopener noreferrer">{copy.checkPosts}</a>.</> : ` ${copy.retry}`}</p>}
      {uploadMessage && <p className={styles.uploadNotice} role="status">{uploadMessage}</p>}
      <Step n={1} title={text.destinations} help={text.destinationsHelp}>
        {selected.length ? <ul className={styles.chosen} aria-label={text.destinations}>{selected.map(target => {
          const channelName = profiles?.channels.find(channel => channel.id === target.id) ? profileChannelName(profiles.channels.find(channel => channel.id === target.id)!) : target.name;
          const format = heldFormat(target);
          return <li key={target.id}>
            <Avatar name={channelName} size={26} />
            <span className={styles.chosenName}>{channelName}</span>
            {target.platformName ? <Badge tone="neutral">{target.platformName}</Badge> : null}
            {format && target.publishingFormats && target.publishingFormats.length > 1 ? <span className={styles.chosenMeta}>{text.formatLabel(format.label)}</span> : null}
          </li>;
        })}</ul> : <p className={styles.fieldHelp}>{text.noDestination}</p>}
      </Step>
      <Step n={2} title={text.content}>
      <label htmlFor="composer-message">Post text <span>(optional with a link or media)</span></label>
      <AutoTextarea id="composer-message" name="message" disabled={saved} value={message} onChange={event => setMessage(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={7} placeholder="Write a post for your team…" aria-describedby="composer-message-count" />
      <div className={styles.fieldMeta} id="composer-message-count">{message.length.toLocaleString()} / {imageRules.maxMessageCharacters.toLocaleString()}</div>
      <AiAssist status={aiStatus} locale={aiLocale} text={message} disabled={pending || saved} onUse={(suggestion, kind) => setMessage(current => (kind === 'hashtags' ? `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${suggestion}` : suggestion).slice(0, imageRules.maxMessageCharacters))} />
      </Step>
      <Step n={3} title={text.media}>
      <fieldset className={styles.attachments} disabled={uploading || pending || saved}>
        <legend>Attachments <span>(optional)</span></legend>
        <label htmlFor="composer-link">Link <span>(optional)</span></label>
        <input id="composer-link" name="link" type="url" value={link} onChange={event => setLink(event.currentTarget.value)} placeholder="https://example.com" />
        <PostAttachments controller={attachments} disabled={uploading || pending || saved} />
        <small>Attachment support depends on the selected destinations.</small>
      </fieldset>
      </Step>
      <Step n={4} title={text.firstComment}>
      <label htmlFor="composer-first-comment">First comment <span>(optional)</span></label>
      <AutoTextarea id="composer-first-comment" name="firstComment" disabled={saved} value={firstComment} onChange={event => setFirstComment(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={3} placeholder="Add a link or follow-up as the first comment…" />
      <label htmlFor="composer-first-comment-delay">Wait before the first comment <span>(minutes; 0 sends it right after publication)</span></label>
      <input id="composer-first-comment-delay" name="firstCommentDelayMinutes" type="number" inputMode="numeric" min={0} max={maxFirstCommentDelayMinutes} step={1} value={firstCommentDelayMinutes} disabled={saved} aria-invalid={Boolean(firstCommentDelayError)} aria-describedby={`composer-first-comment-delay-help${firstCommentDelayError ? ' composer-first-comment-delay-error' : ''}`} onChange={event => { setFirstCommentDelayMinutes(event.currentTarget.value); setFirstCommentDelayError(''); }} />
      <p id="composer-first-comment-delay-help" className={styles.fieldHelp}>Choose a whole number from 0 to {maxFirstCommentDelayMinutes.toLocaleString()} minutes. This applies only when a first comment is saved.</p>
      {firstCommentDelayError && <p id="composer-first-comment-delay-error" className={styles.error} role="alert">{firstCommentDelayError}</p>}
      <input type="hidden" name="labelId" value={labelId} />
      <input type="hidden" name="queueLocale" value={aiLocale} />
      <input type="hidden" name="destinationFormatsJson" value={destinationFormatsJson} />
      <input type="hidden" name="draftPostId" value={draftPostId} />
      </Step>

      <Step n={5} title={text.scheduling} help={text.schedulingHelp(schedule.timeZone.replaceAll('_', ' '))}>
        <fieldset className={styles.scheduleFields} disabled={pending || uploading || saved}>
          <legend className="ui-visually-hidden">{text.scheduling}</legend>
          <div className={styles.dateTime}>
            <Field label={text.date}><TextInput type="date" name="scheduleDate" value={scheduleDate} onChange={event => setScheduleDate(event.currentTarget.value)} /></Field>
            <Field label={text.time}><TextInput type="time" name="scheduleTime" value={scheduleTime} onChange={event => setScheduleTime(event.currentTarget.value)} /></Field>
          </div>
          <BestTimeSuggestions targetIds={selectedTargets} locale={aiLocale} disabled={pending || uploading || saved} onChoose={({ date, time }) => { setScheduleDate(date); setScheduleTime(time); setMode('schedule'); }} />
          {remoteScheduling?.offered && holdable.length > 0 && <div className={styles.holdChoice}>
            <strong id="composer-hold-legend">{text.whoSends}</strong>
            <RadioCards legend={holdCopy.legend} name="scheduleMode" value={scheduleMode} onChange={value => setScheduleMode(value === 'remote' ? 'remote' : 'application')} options={[
              { value: 'application', label: text.holdApp, description: text.holdAppHint },
              { value: 'remote', label: text.holdPlatform(holdablePlatforms || text.platformFallback), description: `${text.holdPlatformHint(holdablePlatforms || text.platformFallback)} ${holdCopy.window.replace('{min}', holdWindow.min).replace('{max}', holdWindow.max)}` },
            ]} />
          </div>}
          <input type="hidden" name="destinationScheduleModesJson" value={destinationScheduleModesJson} />
          {selected.length > 0 && <ul className={styles.destinationModes} aria-label={text.whoSends}>
            {selected.map(target => {
              const canHold = remoteScheduling?.offered && holdable.some(item => item.id === target.id);
              const effective = canHold ? destinationModes[target.id] ?? scheduleMode : 'application';
              const platform = target.platformName || text.platformFallback;
              return <li key={target.id}>
                <div className={styles.modeRow}>
                  <span className={styles.chosenName}>{target.name}</span>
                  {canHold && selected.length > 1 ? <Select aria-label={`${text.perDestination}: ${target.name}`} value={destinationModes[target.id] ?? ''}
                    onChange={value => setDestinationModes(current => { const next = { ...current }; if (value === 'application' || value === 'remote') next[target.id] = value; else delete next[target.id]; return next; })}
                    options={[{ value: '', label: text.sameAsAbove }, { value: 'application', label: text.holdApp }, { value: 'remote', label: text.holdPlatform(platform) }]} /> : null}
                </div>
                <small>{effective === 'remote' ? text.destinationPlatform(platform) : canHold || !remoteScheduling?.offered ? text.destinationApp : text.destinationAppOnly}</small>
              </li>;
            })}
          </ul>}
          {remoteScheduling?.offered && scheduleMode === 'remote' && appOnly.length > 0 && <small role="status">{holdCopy.appOnly.replace('{names}', appOnly.map(target => target.name).join(', '))}</small>}
          {queueAvailable && <section className={styles.queueSlot} aria-label={copy.legend} aria-live="polite">
            <h3>{copy.legend}</h3>
            {!selected.length ? <p>{copy.chooseDestination}</p>
              : queuePreview === 'loading' || queuePreview === null || previewSelection !== selectedKey ? <p>{copy.loading}</p>
              : queuePreview.status === 'error' ? <><p>{copy.unavailable}</p><Button type="button" size="sm" disabled={pending || uploading || saved} onClick={() => setPreviewRefresh(value => value + 1)}>{copy.retryPreview}</Button></>
              : queuePreview.status === 'full' ? <p>{copy.full}</p>
              : <>
                <p><strong>{fill(copy.next, { time: formatDate(new Date(queuePreview.scheduledAt), schedule.timeZone) })}</strong></p>
                {selected.length > 1 && <ul>{queuePreview.channels.map(channel => { const name = selected.find(target => target.id === channel.targetId)?.name ?? ''; return <li key={channel.targetId}>{channel.nextAt ? fill(copy.channelLine, { name, time: formatDate(new Date(channel.nextAt), schedule.timeZone) }) : fill(copy.channelFull, { name })}</li>; })}</ul>}
                <small>{copy.estimate}</small>
              </>}
            <small>{copy.hint}</small>
          </section>}
        </fieldset>
        {autosaveSeconds > 0 && <p className={styles.autosave} aria-live="polite">{autosave.status === 'saving' ? text.autosaveSaving : autosave.status === 'saved' && autosave.at ? text.autosaveSaved(autosave.at) : autosave.status === 'error' ? text.autosaveFailed : text.autosaveOn}</p>}
      </Step>
    </form>

    <section className={styles.previewPanel} aria-labelledby="composer-preview-title">
      <div className={styles.previewHeading}><h2 id="composer-preview-title">Preview</h2><span>Neutral preview</span></div>
      <div className={styles.unsavedLabel}>{saved ? 'Saved post preview' : 'Unsaved preview'} · no destination response is available yet</div>
      <PostPreview post={previewPost} authorName={authorName || 'Your team'} timeZone={schedule.timeZone} variant="card" mediaOverride={<AuthoringMediaPreview controller={attachments} />} />
      {mode === 'schedule' && scheduleDate && scheduleTime && <p className={styles.schedulePreview}>Will schedule for {scheduleDate} at {scheduleTime} ({schedule.timeZone.replaceAll('_', ' ')}).</p>}
      {mode === 'queue' && typeof queuePreview === 'object' && queuePreview?.status === 'ready' && previewSelection === selectedKey && <p className={styles.schedulePreview}>{fill(copy.next, { time: formatDate(new Date(queuePreview.scheduledAt), schedule.timeZone) })}</p>}
    </section>

    <SidebarDock>
      <aside className={styles.sidebarControls} aria-label="Post destinations and timing">
        {templates.length > 0 && <Button type="button" variant="secondary" disabled={pending || uploading || saved} onClick={() => setTemplateChooserOpen(true)}>Choose template</Button>}
        <div className={styles.actions}>
          <Button form={FORM_ID} type="submit" name="intent" value="draft" disabled={pending || uploading || saved} onClick={() => setMode('draft')}>{uploading ? 'Uploading…' : saved ? 'Opening…' : pending ? 'Saving…' : 'Save draft'}</Button>
          <Button form={FORM_ID} type="submit" name="intent" value="schedule" variant="primary" disabled={pending || uploading || saved} onClick={() => setMode('schedule')}>{uploading ? 'Uploading…' : saved ? 'Opening…' : pending ? 'Saving…' : 'Schedule post'}</Button>
          {queueAvailable && <Button form={FORM_ID} type="submit" name="intent" value="queue" disabled={pending || uploading || saved || !(queuePreview && typeof queuePreview === 'object' && queuePreview.status === 'ready' && previewSelection === selectedKey)} onClick={() => setMode('queue')}>{uploading ? 'Uploading…' : saved ? 'Opening…' : pending ? 'Saving…' : copy.button}</Button>}
        </div>
        <fieldset className={styles.destinationList} disabled={pending || uploading || saved}>
          <legend>Destinations</legend>
          {profiles && <GroupShortcut groups={profiles.groups} allowedIds={targets.filter(target => target.canPublish).map(target => target.id)} onSelect={setSelectedTargets} locale={aiLocale} disabled={pending || uploading || saved} />}
          {targets.filter(target => target.canPublish).length ? targets.filter(target => target.canPublish).map(target => <label key={target.id}>
            <input form={FORM_ID} type="checkbox" name="targetIds" value={target.id} checked={selectedTargets.includes(target.id)} onChange={event => { const checked = event.currentTarget.checked; setSelectedTargets(current => checked ? [...current, target.id] : current.filter(id => id !== target.id)); }} />
            <span>{profiles?.channels.find(channel => channel.id === target.id) ? profileChannelName(profiles.channels.find(channel => channel.id === target.id)!) : target.name}</span>
          </label>) : <p>No destinations are ready to publish right now.</p>}
          <small>Drafts can be saved without a destination. Scheduling needs at least one.</small>
          {crowded && <p className={styles.spacingWarning} role="status">{workspaceOperationsCopy.en.spacingWarning.replace('{minutes}', String(spacingGapMinutes))}</p>}
        </fieldset>
        {selected.some(target => target.publishingFormats?.length) && <fieldset className={styles.destinationList} disabled={pending || uploading || saved}>
          <legend>Formats</legend>
          <DestinationFormats targets={targets} selectedIds={selected.map(target => target.id)} values={formatChoices} formId={FORM_ID} disabled={pending || uploading || saved} onChange={(id, value) => setFormatChoices(current => ({ ...current, [id]: value }))} />
        </fieldset>}
      </aside>
    </SidebarDock>
    <Dialog open={templateChooserOpen} title="Choose a post template" description="This copies saved message text, first comment and its delay into the current composer. It does not create or publish a post." onClose={() => setTemplateChooserOpen(false)} actions={<Button data-dialog-cancel onClick={() => setTemplateChooserOpen(false)}>Close</Button>}>
      <label className={styles.templateSearch}>Search templates<input type="search" value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} maxLength={120} /></label>
      {visibleTemplates.length ? <ul className={styles.templateList}>{visibleTemplates.map(template => <li key={template.id}><div><strong>{template.name}</strong><span>{template.category || 'Uncategorized'}</span><p>{template.body}{template.hashtags ? `\n${template.hashtags}` : ''}</p>{template.labelId && <small>Using this template will apply its workspace label to the new post.</small>}</div><Button type="button" size="sm" onClick={() => chooseTemplate(template)}>Use template</Button></li>)}</ul> : <p>No templates match this search.</p>}
    </Dialog>
    <Dialog open={Boolean(templateToApply)} title="Replace the current draft text?" description="The template will replace the current message, first comment and its delay. Your selected destinations, attachments, link and schedule stay as they are." onClose={() => setTemplateToApply(null)} actions={<><Button data-dialog-cancel onClick={() => setTemplateToApply(null)}>Keep current draft</Button><Button variant="primary" onClick={() => templateToApply && applyTemplate(templateToApply)}>Replace message and first comment</Button></>}>
      <p><strong>{templateToApply?.name}</strong></p><p>{templateToApply?.body}</p>{templateToApply?.hashtags && <p>{templateToApply.hashtags}</p>}
    </Dialog>
  </div>;
}
