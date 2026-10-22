'use client';
import { IconAlertTriangle, IconCalendarEvent, IconCheck, IconChevronDown, IconInfoCircle, IconPlus, IconTemplate, IconX } from '@tabler/icons-react';
import { BestTimeSuggestions } from './BestTimeSuggestions';
import { GroupShortcut } from '@/modules/settings/ui/profiles/GroupShortcut';
import { profileChannelName, type ProfileDirectory } from '@/modules/settings/channel-profiles/contracts';

import { usePreserveFormState } from '@/components/usePreserveFormState';
import { AutoTextarea } from '@/components/AutoTextarea';
import { ActionBar, Button, Field, InfoTip, Popover, RadioCards, Select, SplitButton, TextInput } from '@/components';
import { Dialog } from '@/components/Dialog';
import { Avatar } from '@/modules/publishing/ui/kit/kit';
import { catalogGroup, composerCatalogDefaults, composerText, fillComposerCopy, type ComposerCatalog } from '../../composer-catalog';
import { PostPreview } from '@/components/PostPreview';
import { useContent } from '../ContentProvider';
import { fillContent } from '../content-copy';
import { LibraryPicker } from './LibraryPicker';
import { AuthoringMediaPreview, PostAttachments, usePostAttachments, type PostMediaItem } from '@/modules/publishing/components/PostAttachments';
import { publishingMediaIssue, publishingMediaFormatter, type PublishingMediaIssueFormatter } from '@/modules/publishing/media-support';
import { DestinationFormats, effectiveDestinationFormat } from '@/modules/publishing/components/DestinationFormats';
import type { PublishingFormatDescriptor, PublishingMediaSupport } from '@/platforms/types';
import { useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createPostWithRecoveryAction } from '@/modules/publishing/ui/posts/actions';
import { crowdedDestinationPlatforms } from '@/modules/settings/workspace-operations';
import { AiAssist } from '@/modules/ai/components/AiAssist';
import type { AiStatus } from '@/modules/ai/ai';
import { autosaveDraftAction, previewQueueAction, saveQueueComposerAction, type QueueComposerState as ComposerActionState, type QueuePreviewState } from './queue-actions';
import { fill } from './queue-copy';
import { holdsRemotely, leadLabel } from './remote-copy';
import { formatDate } from '@/modules/publishing/ui/publishing-ui';
import styles from './PostComposer.module.css';
import { ComposerCopyProvider } from './CopyProvider';

type LocalImageUpload = { maxBytes: number; mimeTypes: readonly string[] };
type TargetChoice = {
  id: string; name: string; type: string; provider: string | null; canPublish: boolean;
  pictureUrl?: string | null;
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

async function saveWithTransportRecovery(failureMessage: string, previous: ComposerActionState, data: FormData): Promise<ComposerActionState> {
  try { return await (data.get('intent') === 'queue' || previous.values.draftPostId || data.get('draftPostId') ? saveQueueComposerAction(previous, data) : createPostWithRecoveryAction(previous, data)); }
  catch (error) {
    // Next redirects are framework control flow and must reach its action router.
    if (error && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) throw error;
    return { status: 'error', saveUnconfirmed: true, message: failureMessage, values: previous.values };
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

function localUploadIssue(targets: TargetChoice[], items: ReturnType<typeof usePostAttachments>['items'], ui: ReturnType<typeof catalogGroup<'ui'>>) {
  const files = items.filter(item => item.source === 'upload' && item.file);
  for (const target of targets) {
    for (const item of files) {
      const file = item.file!;
      const upload = target.localImageUpload;
      if (!upload) return fillComposerCopy(ui.uploadMissing, { name: target.name });
      if (!upload.mimeTypes.includes(file.type)) return fillComposerCopy(ui.uploadMime, { name: target.name, type: file.type || ui.imageFormat });
      if (file.size > upload.maxBytes) return fillComposerCopy(ui.uploadMax, { name: target.name, max: Math.ceil(upload.maxBytes / 1048576) });
    }
  }
  return null;
}

function selectedMediaIssue(targets: TargetChoice[], formats: Record<string, string>, media: readonly PostMediaItem[], link: string, items: ReturnType<typeof usePostAttachments>['items'], ui: ReturnType<typeof catalogGroup<'ui'>>, format: PublishingMediaIssueFormatter) {
  if (!targets.length) return null;
  const completeMedia = items.map(item => ({ kind: item.kind, url: item.url || 'media:pending', ...(item.altText === undefined ? {} : { altText: item.altText }) }));
  for (const target of targets) {
    const issue = publishingMediaIssue(mediaSupport(target, formats),completeMedia.length ? completeMedia : media, link, format);
    if (issue) return `${target.name}: ${issue}`;
  }
  return localUploadIssue(targets, items, ui);
}

function PostComposerContent({ copyCatalog = composerCatalogDefaults, profiles, targets, templates = [], imageRules, schedule, authorName, createdAt, createdAtDisplay, maxFirstCommentDelayMinutes, spacingGapMinutes = 0, aiStatus, aiLocale = 'en', queueAvailable = false, remoteScheduling, autosaveSeconds = 0, initialTargetIds = [], closeHref = '/content' }: { initialTargetIds?: string[]; closeHref?: string; copyCatalog?: ComposerCatalog; autosaveSeconds?: number; remoteScheduling?: { offered: boolean; defaultMode: 'application' | 'remote' }; profiles?: ProfileDirectory; queueAvailable?: boolean; aiStatus?: AiStatus; aiLocale?: 'en' | 'fr'; targets: TargetChoice[]; templates?: ComposerTemplate[]; imageRules: ImageRules; schedule: Schedule; authorName: string; createdAt: Date; createdAtDisplay: string; maxFirstCommentDelayMinutes: number; spacingGapMinutes?: number }) {
  const router = useRouter();
  const navigated = useRef<ComposerActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  usePreserveFormState(formRef);
  const [state, formAction, pending] = useActionState(saveWithTransportRecovery.bind(null, copyCatalog.transportFailure[aiLocale]), INITIAL_STATE);
  const saved = state.status === 'success';
  const initial = state.values;
  const [message, setMessage] = useState(initial.message ?? '');
  const [firstComment, setFirstComment] = useState(initial.firstComment ?? '');
  const [firstCommentDelayMinutes, setFirstCommentDelayMinutes] = useState(initial.firstCommentDelayMinutes ?? '0');
  const [firstCommentDelayError, setFirstCommentDelayError] = useState('');
  const [labelId, setLabelId] = useState(initial.labelId ?? '');
  const [link, setLink] = useState(initial.link ?? '');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(initial.targetIds ?? initialTargetIds);
  const [formatChoices, setFormatChoices] = useState<Record<string, string>>(() => parseFormats(initial.destinationFormatsJson));
  const [scheduleDate, setScheduleDate] = useState(initial.scheduleDate ?? schedule.date);
  const [scheduleTime, setScheduleTime] = useState(initial.scheduleTime ?? schedule.time);
  const [mode, setMode] = useState<'draft' | 'schedule' | 'queue'>((initial.intent as 'draft' | 'schedule' | 'queue') ?? 'draft');
  const [scheduleMode, setScheduleMode] = useState<'application' | 'remote'>(initial.scheduleMode === 'remote' || initial.scheduleMode === 'application' ? initial.scheduleMode : remoteScheduling?.defaultMode ?? 'application');
  const [destinationModes, setDestinationModes] = useState<Record<string, 'application' | 'remote'>>(() => parseModes(initial.destinationScheduleModesJson));
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [previewSelection, setPreviewSelection] = useState('');
  const [queuePreview, setQueuePreview] = useState<QueuePreviewState | 'loading' | null>(null);
  const ui = catalogGroup(copyCatalog, 'ui', aiLocale);
  const copy = catalogGroup(copyCatalog, 'queue', aiLocale);
  const [localError, setLocalError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateToApply, setTemplateToApply] = useState<ComposerTemplate | null>(null);
  const [uploading, setUploading] = useState(false);
  const submitGuard = useRef<'ready' | 'uploading' | 'submitting'>('ready');
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const text = composerText(copyCatalog, aiLocale);
  const { copy: cc, policy } = useContent();
  // The action bar buttons live outside the form. They pick an intent first, then submit the form, so every path (draft, schedule, queue, publish now) uses the same validation and server actions.
  const intentRef = useRef<'draft' | 'schedule' | 'queue'>((initial.intent as 'draft' | 'schedule' | 'queue') ?? 'draft');
  const [intent, setIntent] = useState<'draft' | 'schedule' | 'queue'>(intentRef.current);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const scheduleAnchor = useRef<HTMLDivElement>(null);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [commentOpen, setCommentOpen] = useState(Boolean(initial.firstComment));
  const [previewChannelId, setPreviewChannelId] = useState('');
  const titleId = useId();
  // The sheet covers the page: the page behind stays still while it is open.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => { root.style.overflow = previous; };
  }, []);
  // Background draft saving: the first save creates the draft, later saves update it, and a manual save reuses its id.
  const [draftPostId, setDraftPostId] = useState(initial.draftPostId ?? '');
  const [autosave, setAutosave] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; at?: string }>({ status: 'idle' });
  const autosaveInFlight = useRef<Promise<unknown> | null>(null);
  const waitingForAutosave = useRef(false);
  const lastAutosaveAttempt = useRef('');
  const lastAutosaved = useRef('');
  const draftIdRef = useRef(initial.draftPostId ?? '');
  const selected = useMemo(() => targets.filter(target => selectedTargets.includes(target.id) && target.canPublish), [targets, selectedTargets]);
  // The choice appears only when a selected destination's own module declares it can hold a scheduled post.
  const holdCopy = catalogGroup(copyCatalog, 'remote', aiLocale);
  const heldFormat = (target: TargetChoice) => target.publishingFormats?.find(format => format.id === effectiveDestinationFormat(target, formatChoices));
  const holdable = selected.filter(target => holdsRemotely(heldFormat(target)));
  const appOnly = selected.filter(target => !holdsRemotely(heldFormat(target)));
  const holdablePlatforms = [...new Set(holdable.flatMap(target => target.platformName ? [target.platformName] : []))].join(' + ');
  const holdLeads = holdable.map(target => heldFormat(target)!.scheduling.nativeLeadSeconds!);
  const holdWindow = { min: leadLabel(Math.max(0, ...holdLeads.map(lead => lead.min)), aiLocale, copyCatalog), max: leadLabel(Math.min(...holdLeads.map(lead => lead.max)), aiLocale, copyCatalog) };
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
  // The delay only matters with a first comment (or a value already set, e.g. from a template or an error to fix).
  const showCommentDelay = Boolean(firstComment.trim() || firstCommentDelayError || (firstCommentDelayMinutes !== '' && Number(firstCommentDelayMinutes) !== 0));
  const templateContentExists =Boolean(message.trim() || firstComment.trim() || link.trim() || attachments.items.length);
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
    if (!autosaveSeconds || saved || pending || uploading || pendingFiles || autosaveInFlight.current || waitingForAutosave.current || submitGuard.current !== 'ready') return;
    if (autosaveSignature === lastAutosaved.current || (!message.trim() && !link.trim() && !attachments.media.length)) return;
    if (autosaveSignature === lastAutosaveAttempt.current) return;
    const delay = firstCommentDelayMinutes === '' ? 0 : Number(firstCommentDelayMinutes);
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > maxFirstCommentDelayMinutes) return;
    const timer = setTimeout(() => {
      // Typing while the request is pending must not create a second draft or
      // allow an older update to overwrite a newer one.
      if (autosaveInFlight.current || waitingForAutosave.current || submitGuard.current !== 'ready') return;
      lastAutosaveAttempt.current = autosaveSignature;
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
  }, [autosaveSeconds, autosaveSignature, autosave.status, saved, pending, uploading, pendingFiles, message, firstComment, firstCommentDelayMinutes, labelId, link, attachments.media, destinationFormatsJson, selected, draftPostId, maxFirstCommentDelayMinutes, aiLocale, schedule.timeZone]);

  // The chosen queue time is shown before saving. A save that placed (or failed to place) a post changes what is free, so it refreshes too.
  const selectedKey = JSON.stringify(selected.map(target => target.id));
  useEffect(() => {
    if (!queueAvailable || selectedKey === '[]') { setQueuePreview(null); return; }
    let current = true;
    setQueuePreview('loading');
    const timer = setTimeout(() => {
      previewQueueAction(JSON.parse(selectedKey)).then(
        result => { if (current) { setPreviewSelection(selectedKey); setQueuePreview(result); } },
        () => { if (current) { setPreviewSelection(selectedKey); setQueuePreview({ status: 'error', message: copy.unavailable }); } },
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
    targets: selected.map(target => ({ status: 'pending', remotePostId: null, remoteUrl: null, target: { id: target.id, type: target.type, name: target.name, pictureUrl: target.pictureUrl ?? null } })),
  }), [message, firstComment, link, attachments.media, createdAt, createdAtDisplay, selected]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    // A background save still in flight must finish first so the manual save reuses its draft instead of creating a second one.
    if (autosaveInFlight.current) {
      event.preventDefault();
      if (waitingForAutosave.current) return;
      waitingForAutosave.current = true;
      try { await autosaveInFlight.current; }
      finally { waitingForAutosave.current = false; }
      if (!form.isConnected) return;
      flushSync(() => setDraftPostId(draftIdRef.current));
      form.requestSubmit();
      return;
    }
    const intent = intentRef.current === 'schedule' ? 'schedule' : intentRef.current === 'queue' && queueAvailable ? 'queue' : 'draft';
    setMode(intent);
    setLocalError('');
    setUploadMessage('');
    const hasContent = Boolean(message.trim() || link.trim() || attachments.items.some(item => item.file || item.url.trim()));
    if (!hasContent) {
      event.preventDefault(); setLocalError(ui.contentRequired);
      form.elements.namedItem('message') instanceof HTMLElement && (form.elements.namedItem('message') as HTMLElement).focus(); return;
    }
    const delayValue = firstCommentDelayMinutes === '' ? 0 : Number(firstCommentDelayMinutes);
    if (!Number.isSafeInteger(delayValue) || delayValue < 0 || delayValue > maxFirstCommentDelayMinutes) {
      event.preventDefault();
      setFirstCommentDelayError(fillComposerCopy(ui.delayRange, { max: maxFirstCommentDelayMinutes.toLocaleString(aiLocale) }));
      form.querySelector<HTMLInputElement>('#composer-first-comment-delay')?.focus();
      return;
    }
    setFirstCommentDelayError('');
    if (message.length > imageRules.maxMessageCharacters) {
      event.preventDefault(); setLocalError(fillComposerCopy(ui.textMax, { max: imageRules.maxMessageCharacters.toLocaleString(aiLocale) })); return;
    }
    if (link.trim()) {
      let valid = false;
      try { const parsed = new URL(link); valid = parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { /* shown as a field error */ }
      if (!valid) { event.preventDefault(); setLocalError(ui.invalidLink); document.getElementById('composer-link')?.focus(); return; }
    }
    if (intent === 'schedule' && (!scheduleDate || !scheduleTime || !selected.length)) {
      event.preventDefault(); setLocalError(!selected.length ? ui.needDestination : ui.needTime); return;
    }
    if (intent === 'queue' && (!selected.length || !queuePreview || typeof queuePreview !== 'object' || queuePreview.status !== 'ready' || previewSelection !== selectedKey)) { event.preventDefault(); setLocalError(!selected.length ? copy.needDestination : copy.unavailable); return; }
    if (!attachments.validate()) { event.preventDefault(); setLocalError(ui.fixAttachments); form.querySelector<HTMLElement>('[role="alert"]')?.focus(); return; }

    const supportIssue = selectedMediaIssue(selected, formatChoices, attachments.media, link, attachments.items, ui, publishingMediaFormatter(copyCatalog, aiLocale));
    if (supportIssue) { event.preventDefault(); attachments.setError(supportIssue); setLocalError(ui.reviewAttachments); form.querySelector<HTMLElement>('[role="alert"]')?.focus(); return; }

    const hasPendingUploads = attachments.items.some(item => item.source === 'upload' && item.file);
    if (hasPendingUploads) {
      event.preventDefault();
      if (submitGuard.current !== 'ready') return;
      submitGuard.current = 'uploading';
      setUploading(true);
      setUploadMessage(ui.uploadingImages);
      try {
        if (!await attachments.prepareUploads()) {
          setUploadMessage(ui.uploadPartial);
          return;
        }
        submitGuard.current = 'ready';
        flushSync(() => { setUploadMessage(''); setUploading(false); });
        form.requestSubmit();
      } catch {
        setUploadMessage(ui.uploadFailure);
      } finally {
        setUploading(false);
        if (submitGuard.current === 'uploading') submitGuard.current = 'ready';
      }
      return;
    }
    if (submitGuard.current !== 'ready') { event.preventDefault(); return; }
    submitGuard.current = 'submitting';
  }

  const postable = targets.filter(target => target.canPublish);
  const blocked = targets.filter(target => !target.canPublish);
  const channelName = (target: TargetChoice) => profiles?.channels.find(channel => channel.id === target.id) ? profileChannelName(profiles.channels.find(channel => channel.id === target.id)!) : target.name;
  const busy = pending || uploading || saved;
  const hasTime = Boolean(scheduleDate && scheduleTime);
  const hasContent = Boolean(message.trim() || link.trim() || attachments.items.length);
  const queueReady = Boolean(queuePreview && typeof queuePreview === 'object' && queuePreview.status === 'ready' && previewSelection === selectedKey);
  const dateLabel = (date: string, time: string) => new Intl.DateTimeFormat(aiLocale, { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(`${date}T${time}:00Z`));
  const previewTargets = previewChannelId && selected.some(target => target.id === previewChannelId) ? previewPost.targets.filter(row => row.target.id === previewChannelId) : previewPost.targets;
  const toggleTarget = (id: string) => setSelectedTargets(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);

  /** Pick the intent, then submit through the form so validation, uploads and the server action are the same for every button. */
  function submitWith(next: 'draft' | 'schedule' | 'queue', when?: { date: string; time: string }) {
    flushSync(() => { setPane('edit'); setIntent(next); if (when) { setScheduleDate(when.date); setScheduleTime(when.time); } });
    intentRef.current = next;
    formRef.current?.requestSubmit();
  }
  /** "Publish now" is a schedule a short, configurable moment ahead; the delivery worker then sends it like any scheduled post. */
  function publishNow() {
    setPublishConfirm(false);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + policy.publishNowLeadMinutes * 60_000));
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
    submitWith('schedule', { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` });
  }
  function leave() {
    let sameSite = false;
    try { sameSite = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin; } catch { /* use the fallback address */ }
    if (sameSite && window.history.length > 1) router.back(); else router.push(closeHref);
  }
  function requestClose() {
    if (hasContent && !saved && autosaveSignature !== lastAutosaved.current) setLeaveConfirm(true); else leave();
  }
  function onSheetKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]') || scheduleOpen) return;
    event.preventDefault();
    requestClose();
  }

  const status = localError ? <p ref={feedbackRef} className={styles.alert} role="alert" tabIndex={-1}><IconAlertTriangle size={16} aria-hidden="true" /><span>{localError}</span></p>
    : state.status === 'error' ? <p ref={feedbackRef} className={styles.alert} role="alert" data-composer-error tabIndex={-1}><IconAlertTriangle size={16} aria-hidden="true" /><span>{state.message} {copy.retained}{state.saveUnconfirmed ? <> <a href="/content" target="_blank" rel="noopener noreferrer">{cc.createOpenContent}</a>.</> : ` ${copy.retry}`}</span></p>
    : saved ? <p ref={feedbackRef} tabIndex={-1} className={styles.ok} role="status"><IconCheck size={16} aria-hidden="true" /><span>{state.queued ? fill(state.queued.status === 'pending_approval' ? copy.addedApproval : copy.added, { time: formatDate(new Date(state.queued.scheduledAt), schedule.timeZone) }) : ui.saved} {copy.opening} {state.destination && <a href={state.destination}>{copy.viewSaved}</a>}</span></p>
    : uploadMessage ? <span>{uploadMessage}</span>
    : autosave.status === 'saving' ? <span>{cc.createStatusSaving}</span>
    : autosave.status === 'error' ? <span>{cc.createStatusAutosaveFailed}</span>
    : autosave.status === 'saved' && autosave.at ? <span>{fillContent(cc.createStatusSaved, { time: autosave.at })}</span>
    : <span>{hasContent ? cc.createStatusReady : cc.createStatusNeedContent}</span>;

  const mainLabel = uploading ? cc.createUploading : pending ? cc.createWorking : hasTime ? fillContent(cc.createScheduleFor, { when: dateLabel(scheduleDate, scheduleTime) }) : cc.createSchedule;
  const queueErrored = typeof queuePreview === 'object' && queuePreview?.status === 'error' && previewSelection === selectedKey;
  const queueLabel = !selected.length ? cc.createQueueNeedChannel : queuePreview === 'loading' || queuePreview === null || previewSelection !== selectedKey ? cc.createQueueLoading
    : queueErrored ? cc.createQueueRetry
    : typeof queuePreview === 'object' && queuePreview.status === 'ready' ? fillContent(cc.createQueueAt, { when: formatDate(new Date(queuePreview.scheduledAt), schedule.timeZone) }) : cc.createQueueFull;

  return <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onSheetKey}>
    <header className={styles.top}>
      <h1 id={titleId}>{cc.createTitle}</h1>
      <div className={styles.topEnd}>
        {templates.length > 0 && <Button type="button" variant="quiet" size="sm" leading={<IconTemplate size={16} aria-hidden="true" />} disabled={busy} onClick={() => setTemplateChooserOpen(true)}>{cc.createTemplates}</Button>}
        <Button type="button" variant="quiet" size="sm" aria-label={cc.createClose} onClick={requestClose} leading={<IconX size={18} aria-hidden="true" />} />
      </div>
    </header>
    <div className={styles.paneSwitch} role="group" aria-label={cc.createTitle}>
      <button type="button" aria-pressed={pane === 'edit'} onClick={() => setPane('edit')}>{cc.createTabEdit}</button>
      <button type="button" aria-pressed={pane === 'preview'} onClick={() => setPane('preview')}>{cc.createTabPreview}</button>
    </div>
    <div className={styles.main} data-pane={pane}>
    <form id={FORM_ID} ref={formRef} action={formAction} onSubmit={onSubmit} className={styles.editor} noValidate onKeyDown={event => { const target = event.target as HTMLInputElement; if (event.key === 'Enter' && target.tagName === 'INPUT' && target.type !== 'submit') event.preventDefault(); }}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="scheduleDate" value={scheduleDate} />
      <input type="hidden" name="scheduleTime" value={scheduleTime} />
      {selected.map(target => <input key={target.id} type="hidden" name="targetIds" value={target.id} />)}
      <section className={styles.section} aria-labelledby={`${titleId}-channels`}>
        <div className={styles.sectionHead}><h2 id={`${titleId}-channels`}>{cc.createChannels}</h2><InfoTip name={cc.createChannels}>{cc.createChannelsInfo}</InfoTip><span className={styles.sectionMeta}>{fillContent(cc.createChannelsSelected, { count: selected.length })}</span></div>
        {profiles && postable.length > 1 && <GroupShortcut groups={profiles.groups} allowedIds={postable.map(target => target.id)} onSelect={setSelectedTargets} locale={aiLocale} disabled={busy} />}
        {postable.length || blocked.length ? <div className={styles.chips} role="group" aria-labelledby={`${titleId}-channels`}>
          {postable.map(target => { const on = selectedTargets.includes(target.id); return <button key={target.id} type="button" className={styles.chip} aria-pressed={on} disabled={busy} onClick={() => toggleTarget(target.id)}>
            <Avatar name={channelName(target)} src={target.pictureUrl} size={24} /><span className={styles.chipName}>{channelName(target)}</span>{on && <IconCheck size={15} stroke={2.4} aria-hidden="true" />}
          </button>; })}
          {blocked.map(target => <span key={target.id} className={styles.chipBlocked} title={fillContent(cc.createChannelBlocked, { name: channelName(target) })}>
            <Avatar name={channelName(target)} src={target.pictureUrl} size={24} /><span className={styles.chipName}>{channelName(target)}</span><a href={policy.reconnectHref}>{cc.createReconnect}</a>
          </span>)}
        </div> : <p className={styles.help}>{cc.createChannelsNone}</p>}
        {crowded && <p className={styles.help} role="status">{fillComposerCopy(ui.spacingWarning, { minutes: spacingGapMinutes })}</p>}
      </section>
      <section className={styles.section} aria-labelledby={`${titleId}-text`}>
        <div className={styles.sectionHead}><h2 id={`${titleId}-text`}>{cc.createText}</h2></div>
        <AutoTextarea id="composer-message" name="message" disabled={saved} value={message} onChange={event => setMessage(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={6} placeholder={cc.createTextPlaceholder} aria-labelledby={`${titleId}-text`} aria-describedby="composer-message-count" />
        <div className={styles.textTools}>
          <AiAssist status={aiStatus} locale={aiLocale} text={message} disabled={pending || saved} onUse={(suggestion, kind) => setMessage(current => (kind === 'hashtags' ? `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${suggestion}` : suggestion).slice(0, imageRules.maxMessageCharacters))} />
          <span className={styles.counter} id="composer-message-count">{fillContent(cc.createCounter, { used: message.length.toLocaleString(aiLocale), max: imageRules.maxMessageCharacters.toLocaleString(aiLocale) })}</span>
        </div>
      </section>
      <section className={styles.section} aria-labelledby={`${titleId}-media`}>
        <div className={styles.sectionHead}><h2 id={`${titleId}-media`}>{cc.createMedia}</h2></div>
        <PostAttachments controller={attachments} disabled={busy} onPickLibrary={() => setLibraryOpen(true)} {...(aiStatus?.available && aiStatus.altText ? { altTextAssist: { locale: aiLocale } } : {})} />
        <label className={styles.linkField} htmlFor="composer-link"><span>{ui.link}</span>
          <input id="composer-link" name="link" type="url" disabled={busy} value={link} onChange={event => setLink(event.currentTarget.value)} placeholder={ui.linkPlaceholder} />
        </label>
        <small className={styles.help}>{ui.attachmentSupport}</small>
      </section>
      <section className={styles.section} aria-labelledby={`${titleId}-comment`}>
        {commentOpen || firstComment.trim() || firstCommentDelayError ? <>
          <div className={styles.sectionHead}><h2 id={`${titleId}-comment`}><label htmlFor="composer-first-comment">{ui.firstComment}</label></h2>
            <Button type="button" variant="quiet" size="sm" disabled={saved} onClick={() => { setFirstComment(''); setCommentOpen(false); setFirstCommentDelayError(''); }}>{cc.createFirstCommentHide}</Button></div>
          <AutoTextarea id="composer-first-comment" name="firstComment" disabled={saved} value={firstComment} onChange={event => setFirstComment(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={3} placeholder={ui.commentPlaceholder} />
        </> : <>
          <input type="hidden" name="firstComment" value="" />
          <button type="button" className={styles.addRow} disabled={saved} onClick={() => setCommentOpen(true)}><IconPlus size={16} aria-hidden="true" />{cc.createFirstCommentAdd}</button>
        </>}
        {!showCommentDelay && <input type="hidden" name="firstCommentDelayMinutes" value={firstCommentDelayMinutes} />}
        {showCommentDelay && <>
          <label className={styles.linkField} htmlFor="composer-first-comment-delay"><span>{ui.commentDelay} <em>{ui.delayHint}</em></span>
            <input id="composer-first-comment-delay" name="firstCommentDelayMinutes" type="number" inputMode="numeric" min={0} max={maxFirstCommentDelayMinutes} step={1} value={firstCommentDelayMinutes} disabled={saved} aria-invalid={Boolean(firstCommentDelayError)} aria-describedby={`composer-first-comment-delay-help${firstCommentDelayError ? ' composer-first-comment-delay-error' : ''}`} onChange={event => { setFirstCommentDelayMinutes(event.currentTarget.value); setFirstCommentDelayError(''); }} /></label>
          <p id="composer-first-comment-delay-help" className={styles.help}>{fillComposerCopy(ui.delayRange, { max: maxFirstCommentDelayMinutes.toLocaleString(aiLocale) })} {ui.delayApplies}</p>
          {firstCommentDelayError && <p id="composer-first-comment-delay-error" className={styles.alert} role="alert">{firstCommentDelayError}</p>}
        </>}
        <input type="hidden" name="labelId" value={labelId} />
        <input type="hidden" name="queueLocale" value={aiLocale} />
        <input type="hidden" name="destinationFormatsJson" value={destinationFormatsJson} />
        <input type="hidden" name="draftPostId" value={draftPostId} />
      </section>

      <details className={styles.advanced}>
        <summary><IconChevronDown size={16} aria-hidden="true" />{cc.createAdvanced}</summary>
        <div className={styles.advancedBody}>
        {selected.some(target => target.publishingFormats?.length) && <fieldset className={styles.group} disabled={busy}>
          <legend>{cc.createAdvancedFormats}</legend>
          <DestinationFormats copyCatalog={copyCatalog} locale={aiLocale} targets={targets} selectedIds={selected.map(target => target.id)} values={formatChoices} formId={FORM_ID} disabled={busy} onChange={(id, value) => setFormatChoices(current => ({ ...current, [id]: value }))} />
        </fieldset>}
        <fieldset className={styles.group} disabled={busy}>
          <legend className="ui-visually-hidden">{text.scheduling}</legend>
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
        </fieldset>
        </div>
      </details>
    </form>

    <aside className={styles.preview} aria-labelledby={`${titleId}-preview`}>
      <div className={styles.sectionHead}><h2 id={`${titleId}-preview`}>{cc.createPreviewTitle}</h2><InfoTip name={cc.createPreviewTitle}>{cc.createPreviewInfo}</InfoTip><span className={styles.sectionMeta}>{saved ? ui.savedPreview : ui.unsavedPreview}</span></div>
      {selected.length > 1 && <div className={styles.previewChannels} role="group" aria-label={cc.createPreviewTitle}>
        <button type="button" aria-pressed={!previewChannelId} onClick={() => setPreviewChannelId('')}>{cc.createChannels}</button>
        {selected.map(target => <button key={target.id} type="button" aria-pressed={previewChannelId === target.id} aria-label={fillContent(cc.createPreviewChannel, { name: channelName(target) })} title={channelName(target)} onClick={() => setPreviewChannelId(target.id)}><Avatar name={channelName(target)} src={target.pictureUrl} size={22} /></button>)}
      </div>}
      <PostPreview post={{ ...previewPost, targets: previewTargets }} authorName={authorName || ui.yourTeam} timeZone={schedule.timeZone} variant="card" mediaOverride={<AuthoringMediaPreview controller={attachments} />} />
      {mode === 'schedule' && hasTime && <p className={styles.timeNote}><IconCalendarEvent size={15} aria-hidden="true" />{fillComposerCopy(ui.schedulePreview, { date: scheduleDate, time: scheduleTime, zone: schedule.timeZone.replaceAll('_', ' ') })}</p>}
      {mode === 'queue' && queueReady && typeof queuePreview === 'object' && queuePreview?.status === 'ready' && <p className={styles.timeNote}><IconCalendarEvent size={15} aria-hidden="true" />{fill(copy.next, { time: formatDate(new Date(queuePreview.scheduledAt), schedule.timeZone) })} <small>{copy.estimate}</small></p>}
    </aside>
    </div>

    <ActionBar label={cc.createActionBar} status={status}>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => submitWith('draft')}>{cc.createSaveDraft}</Button>
      <div ref={scheduleAnchor} className={styles.splitAnchor}>
        <SplitButton label={mainLabel} variant="primary" disabled={busy} busy={pending || uploading} menuLabel={cc.createMoreWays}
          onClick={() => { if (hasTime) submitWith('schedule'); else setScheduleOpen(true); }}
          items={[
            { key: 'now', label: cc.createPublishNow, disabled: !selected.length, disabledReason: cc.createPublishNeedChannel, onSelect: () => setPublishConfirm(true) },
            ...(queueAvailable ? [{ key: 'queue', label: queueLabel, disabled: !queueReady && !queueErrored, onSelect: () => { if (queueErrored) setPreviewRefresh(value => value + 1); else submitWith('queue'); } }] : []),
            { key: 'schedule', label: cc.createScheduleEllipsis, onSelect: () => setScheduleOpen(true) },
          ]} />
        <Popover open={scheduleOpen} anchorRef={scheduleAnchor} onClose={() => setScheduleOpen(false)} sheetOnPhone align="end" role="dialog" label={cc.createPickTime} className={styles.schedulePop}>
          <div className={styles.popHead}><h2>{cc.createPickTime}</h2><button type="button" className={styles.popClose} aria-label={cc.createClose} onClick={() => setScheduleOpen(false)}><IconX size={18} aria-hidden="true" /></button></div>
          <div className={styles.dateTime}>
            <Field label={cc.createDate}><TextInput type="date" value={scheduleDate} onChange={event => setScheduleDate(event.currentTarget.value)} /></Field>
            <Field label={cc.createTime}><TextInput type="time" value={scheduleTime} onChange={event => setScheduleTime(event.currentTarget.value)} /></Field>
          </div>
          <BestTimeSuggestions copyCatalog={copyCatalog} targetIds={selectedTargets} locale={aiLocale} disabled={busy} onChoose={({ date, time }) => { setScheduleDate(date); setScheduleTime(time); setMode('schedule'); }} />
          <p className={styles.help}><IconInfoCircle size={14} aria-hidden="true" /> {fillContent(cc.createZone, { zone: schedule.timeZone.replaceAll('_', ' ') })}</p>
          <div className={styles.popActions}>
            <Button type="button" variant="quiet" size="sm" disabled={!hasTime} onClick={() => { setScheduleDate(''); setScheduleTime(''); }}>{cc.createClearTime}</Button>
            <Button type="button" variant="primary" size="sm" disabled={!hasTime} onClick={() => { setScheduleOpen(false); setMode('schedule'); }}>{cc.createSetTime}</Button>
          </div>
        </Popover>
      </div>
    </ActionBar>

    <LibraryPicker open={libraryOpen} onClose={() => setLibraryOpen(false)} onAdd={ids => attachments.addLibraryImages(ids)} maxSelect={policy.libraryPickerMaxSelect} />
    <Dialog open={publishConfirm} title={cc.createPublishTitle} description={fillContent(cc.createPublishBody, { count: selected.length })} onClose={() => setPublishConfirm(false)}
      actions={<><Button data-dialog-cancel variant="secondary" onClick={() => setPublishConfirm(false)}>{cc.createPublishCancel}</Button><Button variant="primary" onClick={publishNow}>{cc.createPublishGo}</Button></>}>
      <ul className={styles.confirmList}>{selected.map(target => <li key={target.id}><Avatar name={channelName(target)} src={target.pictureUrl} size={22} />{channelName(target)}</li>)}</ul>
    </Dialog>
    <Dialog open={leaveConfirm} title={cc.createCloseTitle} description={cc.createCloseBody} onClose={() => setLeaveConfirm(false)}
      actions={<><Button data-dialog-cancel variant="secondary" onClick={() => setLeaveConfirm(false)}>{cc.createCloseStay}</Button><Button variant="quiet" onClick={() => { setLeaveConfirm(false); leave(); }}>{cc.createCloseDiscard}</Button><Button variant="primary" onClick={() => { setLeaveConfirm(false); submitWith('draft'); }}>{cc.createCloseSave}</Button></>}>
      {null}
    </Dialog>
    <Dialog open={templateChooserOpen} title={ui.templateTitle} description={ui.templateDescription} onClose={() => setTemplateChooserOpen(false)} actions={<Button data-dialog-cancel onClick={() => setTemplateChooserOpen(false)}>{ui.close}</Button>}>
      <label className={styles.templateSearch}>{ui.searchTemplates}<input type="search" value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} maxLength={120} /></label>
      {visibleTemplates.length ? <ul className={styles.templateList}>{visibleTemplates.map(template => <li key={template.id}><div><strong>{template.name}</strong><span>{template.category || ui.uncategorized}</span><p>{template.body}{template.hashtags ? `\n${template.hashtags}` : ''}</p>{template.labelId && <small>{ui.templateLabel}</small>}</div><Button type="button" size="sm" onClick={() => chooseTemplate(template)}>{ui.useTemplate}</Button></li>)}</ul> : <p>{ui.noTemplates}</p>}
    </Dialog>
    <Dialog open={Boolean(templateToApply)} title={ui.replaceTitle} description={ui.replaceDescription} onClose={() => setTemplateToApply(null)} actions={<><Button data-dialog-cancel onClick={() => setTemplateToApply(null)}>{ui.keepDraft}</Button><Button variant="primary" onClick={() => templateToApply && applyTemplate(templateToApply)}>{ui.replaceText}</Button></>}>
      <p><strong>{templateToApply?.name}</strong></p><p>{templateToApply?.body}</p>{templateToApply?.hashtags && <p>{templateToApply.hashtags}</p>}
    </Dialog>
  </div>;
}

export function PostComposer(props: Parameters<typeof PostComposerContent>[0]) {
  return <ComposerCopyProvider catalog={props.copyCatalog ?? composerCatalogDefaults} locale={props.aiLocale ?? 'en'}><PostComposerContent {...props} /></ComposerCopyProvider>;
}
