'use client';
import { IconAlertTriangle, IconCalendarEvent, IconCheck, IconChevronDown, IconInfoCircle, IconPlus, IconSparkles, IconTemplate, IconX } from '@tabler/icons-react';
import { BestTimeSuggestions } from './BestTimeSuggestions';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PostVariantsEditor } from './PostVariantsEditor';
import { GroupShortcut } from '@/modules/settings/ui/profiles/GroupShortcut';
import { profileChannelName, type ProfileDirectory } from '@/modules/settings/channel-profiles/contracts';

import { usePreserveFormState } from '@/components/usePreserveFormState';
import { AutoTextarea } from '@/components/AutoTextarea';
import { ActionBar, Button, Field, InfoTip, Popover, RadioCards, Select, SplitButton, TextInput } from '@/components';
import { Dialog } from '@/components/Dialog';
import { Avatar } from '@/modules/publishing/ui/kit/kit';
import { catalogGroup, composerCatalogDefaults, composerText, fillComposerCopy, type ComposerCatalog } from '../../composer-catalog';
import { useContent } from '../ContentProvider';
import { ChannelPreviewTabs } from './ChannelPreviewTabs';
import { fillContent } from '../content-copy';
import { LibraryPicker } from './LibraryPicker';
import { PostAttachments, usePostAttachments, type PostMediaItem } from '@/modules/publishing/components/PostAttachments';
import { publishingMediaIssue, publishingMediaFormatter, type PublishingMediaIssueFormatter } from '@/modules/publishing/media-support';
import { DestinationFormats, effectiveDestinationFormat } from '@/modules/publishing/components/DestinationFormats';
import type { PublishingFormatDescriptor, PublishingMediaSupport } from '@/platforms/types';
import { useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createPostWithRecoveryAction } from '@/modules/publishing/ui/posts/actions';
import { crowdedDestinationPlatforms } from '@/modules/settings/workspace-operations';
import { AiAssist } from '@/modules/studio/components/AiAssist';
import type { AiStatus } from '@/modules/studio/ai';
import { autosaveDraftAction, previewQueueAction, saveQueueComposerAction, type QueueComposerState as ComposerActionState, type QueuePreviewState } from './queue-actions';
import { fill } from './queue-copy';
import { holdsRemotely, leadLabel } from './remote-copy';
import styles from './PostComposer.module.css';
import { GRID_PREVIEW_TAB, type RecentGridPost } from './ChannelPreviewTabs';
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

/** Facebook folds long text behind "See more" after roughly this many characters on mobile. */
const HOOK_VISIBLE_CHARACTERS = 125;
const HOOK_MAX_HASHTAGS = 5;

function PostComposerContent({ recentPosts = [], copyCatalog = composerCatalogDefaults, profiles, targets, templates = [], labels = [], imageRules, schedule, authorName, createdAt, createdAtDisplay, maxFirstCommentDelayMinutes, spacingGapMinutes = 0, aiStatus, aiLocale = 'en', queueAvailable = false, remoteScheduling, autosaveSeconds = 0, initialTargetIds = [], initialMessage, initialMediaUrls, initialLink, closeHref = '/content' }: { recentPosts?: RecentGridPost[]; initialTargetIds?: string[]; initialMessage?: string; initialMediaUrls?: string[]; initialLink?: string; closeHref?: string; copyCatalog?: ComposerCatalog; autosaveSeconds?: number; remoteScheduling?: { offered: boolean; defaultMode: 'application' | 'remote' }; profiles?: ProfileDirectory; queueAvailable?: boolean; aiStatus?: AiStatus; aiLocale?: 'en' | 'fr'; targets: TargetChoice[]; templates?: ComposerTemplate[]; labels?: Array<{ id: string; name: string }>; imageRules: ImageRules; schedule: Schedule; authorName: string; createdAt: Date; createdAtDisplay: string; maxFirstCommentDelayMinutes: number; spacingGapMinutes?: number }) {
  const router = useRouter();
  const navigated = useRef<ComposerActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  usePreserveFormState(formRef);
  const [state, formAction, pending] = useActionState(saveWithTransportRecovery.bind(null, copyCatalog.transportFailure[aiLocale]), INITIAL_STATE);
  const saved = state.status === 'success';
  const initial = state.values;
  const [message, setMessage] = useState(initial.message ?? initialMessage ?? '');
  const [firstComment, setFirstComment] = useState(initial.firstComment ?? '');
  const [firstCommentDelayMinutes, setFirstCommentDelayMinutes] = useState(initial.firstCommentDelayMinutes ?? '0');
  const [firstCommentDelayError, setFirstCommentDelayError] = useState('');
  // Only a label the server listed can be attached; anything else (a label deleted after a template was saved)
  // would be rejected at save time, so it is dropped here instead of submitted blindly.
  const knownLabel = (id: string | null | undefined) => id && labels.some(label => label.id === id) ? id : '';
  const [labelId, setLabelId] = useState(knownLabel(initial.labelId));
  const [link, setLink] = useState(initial.link ?? initialLink ?? '');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(initial.targetIds ?? initialTargetIds);
  const [formatChoices, setFormatChoices] = useState<Record<string, string>>(() => parseFormats(initial.destinationFormatsJson));
  const [publishNowFlag, setPublishNowFlag] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(initial.scheduleDate ?? schedule.date);
  useEffect(() => { if (!pending) setPublishNowFlag(false); }, [pending]);
  const [scheduleTime, setScheduleTime] = useState(initial.scheduleTime ?? schedule.time);
  const [mode, setMode] = useState<'draft' | 'schedule' | 'queue'>((initial.intent as 'draft' | 'schedule' | 'queue') ?? 'draft');
  const [scheduleMode, setScheduleMode] = useState<'application' | 'remote'>(initial.scheduleMode === 'remote' || initial.scheduleMode === 'application' ? initial.scheduleMode : remoteScheduling?.defaultMode ?? 'application');
  const [destinationModes, setDestinationModes] = useState<Record<string, 'application' | 'remote'>>(() => parseModes(initial.destinationScheduleModesJson));
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [previewSelection, setPreviewSelection] = useState('');
  const [queuePreview, setQueuePreview] = useState<QueuePreviewState | 'loading' | null>(null);
  const ui = catalogGroup(copyCatalog, 'ui', aiLocale);
  const variantCopy = catalogGroup(copyCatalog, 'variant', aiLocale);
  const copy = catalogGroup(copyCatalog, 'queue', aiLocale);
  const [localError, setLocalError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateToApply, setTemplateToApply] = useState<ComposerTemplate | null>(null);
  const [hookScorerOpen, setHookScorerOpen] = useState(false);
  const [hookAnalysis, setHookAnalysis] = useState<{ firstLine: string; checks: Array<{ ok: boolean; text: string }>; rewrite: string | null; rewriting: boolean; error: string } | null>(null);

  /** Plain checks on the opening line (no invented score) plus an optional AI rewrite of that line. */
  const analyzeHook = () => {
    const firstLine = message.split('\n')[0]?.trim() ?? '';
    const hashtags = (message.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
    setHookAnalysis({
      firstLine,
      checks: [
        { ok: firstLine.length > 0 && firstLine.length <= HOOK_VISIBLE_CHARACTERS, text: fillComposerCopy(cc.createHookLength, { n: firstLine.length, max: HOOK_VISIBLE_CHARACTERS }) },
        { ok: message.includes('?'), text: cc.createHookQuestion },
        { ok: hashtags <= HOOK_MAX_HASHTAGS, text: fillComposerCopy(cc.createHookHashtags, { n: hashtags, max: HOOK_MAX_HASHTAGS }) },
      ],
      rewrite: null, rewriting: false, error: '',
    });
    setHookScorerOpen(true);
  };
  const rewriteHook = async () => {
    if (!hookAnalysis?.firstLine) return;
    setHookAnalysis(current => current && { ...current, rewriting: true, error: '' });
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'improve', text: hookAnalysis.firstLine }) });
      const body = await response.json().catch(() => null) as { text?: string; error?: string } | null;
      const text = response.ok && body?.text ? body.text.split('\n')[0]!.trim() : '';
      setHookAnalysis(current => current && { ...current, rewriting: false, rewrite: text || null, error: text ? '' : body?.error || cc.createHookRewriteFailed });
    } catch {
      setHookAnalysis(current => current && { ...current, rewriting: false, error: cc.createHookRewriteFailed });
    }
  };

  const applyHookAlternative = (alt: string) => {
    const lines = message.split('\n');
    lines[0] = alt;
    setMessage(lines.join('\n'));
  };
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
    initialMedia: initial.mediaJson ? initialMedia(initial.mediaJson) : initialMediaUrls?.length ? initialMediaUrls.map(url => ({ kind: 'image' as const, url })) : [],
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
    setLabelId(knownLabel(template.labelId));
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
      data.append('queueLocale', aiLocale);
      setAutosave({ status: 'saving' });
      const run = autosaveDraftAction(draftPostId || null, data).then(result => {
        if (result.status === 'saved') {
          lastAutosaved.current = autosaveSignature;
          draftIdRef.current = result.draftPostId;
          setDraftPostId(result.draftPostId);
          setAutosave({ status: 'saved', at: result.savedLabel });
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
    status: 'draft', scheduledAt: null, publishedAt: null, createdAt, displayTime: createdAtDisplay, unsaved: !draftPostId,
    targets: selected.map(target => ({ status: 'pending', remotePostId: null, remoteUrl: null, target: { id: target.id, type: target.type, name: target.name, pictureUrl: target.pictureUrl ?? null } })),
  }), [message, firstComment, link, attachments.media, createdAt, createdAtDisplay, selected, draftPostId]);

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
    // "Publish now" needs no wall time: the server computes the instant.
    if (intent === 'schedule' && (!selected.length || (!publishNowFlag && (!scheduleDate || !scheduleTime)))) {
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
  const toggleTarget = (id: string) => setSelectedTargets(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  // A deselected channel cannot stay the preview tab.
  // The grid preview is a tab of its own, not a channel.
  useEffect(() => { if (previewChannelId && previewChannelId !== GRID_PREVIEW_TAB && !selectedTargets.includes(previewChannelId)) setPreviewChannelId(''); }, [previewChannelId, selectedTargets]);

  /** Pick the intent, then submit through the form so validation, uploads and the server action are the same for every button. */
  function submitWith(next: 'draft' | 'schedule' | 'queue', when?: { date: string; time: string }, now = false) {
    flushSync(() => { setPane('edit'); setIntent(next); setPublishNowFlag(now); if (when) { setScheduleDate(when.date); setScheduleTime(when.time); } });
    intentRef.current = next;
    formRef.current?.requestSubmit();
  }
  /** "Publish now" is a schedule a short, configurable moment ahead; the delivery worker then sends it like any scheduled post. */
  function publishNow() {
    setPublishConfirm(false);
    // The server computes the instant (now plus the Root lead) so a browser with different time-zone data cannot shift it.
    submitWith('schedule', { date: scheduleDate || schedule.date, time: scheduleTime || schedule.time }, true);
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

  useEffect(() => {
    const handleGlobalShortcuts = (e: globalThis.KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || scheduleOpen) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (!busy && selected.length > 0) {
          e.preventDefault();
          if (hasTime) submitWith('schedule');
          else submitWith('draft');
        }
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        if (!busy) {
          e.preventDefault();
          submitWith('draft');
        }
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [busy, hasTime, selected.length]);

  const status = localError ? <p ref={feedbackRef} className={styles.alert} role="alert" tabIndex={-1}><IconAlertTriangle size={16} aria-hidden="true" /><span>{localError}</span></p>
    : state.status === 'error' ? <p ref={feedbackRef} className={styles.alert} role="alert" data-composer-error tabIndex={-1}><IconAlertTriangle size={16} aria-hidden="true" /><span>{state.message} {copy.retained}{state.saveUnconfirmed ? <> <a href="/content" target="_blank" rel="noopener noreferrer">{cc.createOpenContent}</a>.</> : ` ${copy.retry}`}</span></p>
    : saved ? <p ref={feedbackRef} tabIndex={-1} className={styles.ok} role="status"><IconCheck size={16} aria-hidden="true" /><span>{state.queued ? fill(state.queued.status === 'pending_approval' ? copy.addedApproval : copy.added, { time: state.queued.scheduledLabel }) : ui.saved} {copy.opening} {state.destination && <a href={state.destination}>{copy.viewSaved}</a>}</span></p>
    : uploadMessage ? <span>{uploadMessage}</span>
    : autosave.status === 'saving' ? <span>{cc.createStatusSaving}</span>
    : autosave.status === 'error' ? <span>{cc.createStatusAutosaveFailed}</span>
    : autosave.status === 'saved' && autosave.at ? <span>{fillContent(cc.createStatusSaved, { time: autosave.at })}</span>
    : <span>{hasContent ? cc.createStatusReady : cc.createStatusNeedContent}</span>;

  const mainLabel = uploading ? cc.createUploading : pending ? cc.createWorking : hasTime ? fillContent(cc.createScheduleFor, { when: dateLabel(scheduleDate, scheduleTime) }) : cc.createSchedule;
  const queueErrored = typeof queuePreview === 'object' && queuePreview?.status === 'error' && previewSelection === selectedKey;
  const queueLabel = !selected.length ? cc.createQueueNeedChannel : queuePreview === 'loading' || queuePreview === null || previewSelection !== selectedKey ? cc.createQueueLoading
    : queueErrored ? cc.createQueueRetry
    : typeof queuePreview === 'object' && queuePreview.status === 'ready' ? fillContent(cc.createQueueAt, { when: queuePreview.scheduledLabel }) : cc.createQueueFull;

  return <><div className={styles.backdrop} aria-hidden="true" /><div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onSheetKey}>
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
      {publishNowFlag && <input type="hidden" name="publishNow" value="1" />}
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
        {blocked.length > 0 && <p className={styles.help}>{fillContent(cc.createChannelBlocked, { name: blocked.map(target => channelName(target)).join(', ') })}</p>}
        {crowded && <p className={styles.help} role="status">{fillComposerCopy(ui.spacingWarning, { minutes: spacingGapMinutes })}</p>}
      </section>
      <section className={styles.section} aria-labelledby={`${titleId}-text`}>
        <div className={styles.sectionHead}><h2 id={`${titleId}-text`}>{cc.createText}</h2></div>
        <AutoTextarea id="composer-message" name="message" disabled={saved} value={message} onChange={event => setMessage(event.currentTarget.value)} maxLength={imageRules.maxMessageCharacters} rows={6} placeholder={cc.createTextPlaceholder} aria-labelledby={`${titleId}-text`} aria-describedby="composer-message-count" />
        <div className={styles.textTools}>
          <AiAssist status={aiStatus} locale={aiLocale} text={message} disabled={pending || saved} onUse={(suggestion, kind) => setMessage(current => (kind === 'hashtags' ? `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${suggestion}` : suggestion).slice(0, imageRules.maxMessageCharacters))} />
          <button type="button" className={styles.addRow} style={{ minHeight: '32px', fontSize: '12px' }} onClick={analyzeHook}>
            <IconSparkles size={14} aria-hidden="true" />
            <span>{cc.createHookScore}</span>
          </button>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {imageRules.maxMessageCharacters > 0 && (() => {
              const charPercent = Math.min(100, (message.length / imageRules.maxMessageCharacters) * 100);
              const charStrokeColor = charPercent >= 100 ? 'var(--danger)' : charPercent >= 90 ? 'var(--warning)' : 'var(--accent)';
              return (
                <svg width="18" height="18" viewBox="0 0 20 20" style={{ transform: 'rotate(-90deg)', verticalAlign: 'middle', flexShrink: 0 }} aria-hidden="true">
                  <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line-strong)" strokeWidth="2.5" opacity="0.35" />
                  <circle cx="10" cy="10" r="8" fill="none" stroke={charStrokeColor} strokeWidth="2.5" strokeDasharray={50.26} strokeDashoffset={50.26 - (50.26 * charPercent) / 100} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.15s ease, stroke 0.15s ease' }} />
                </svg>
              );
            })()}
            <span className={styles.counter} id="composer-message-count">{fillContent(cc.createCounter, { used: message.length.toLocaleString(aiLocale), max: imageRules.maxMessageCharacters.toLocaleString(aiLocale) })}</span>
          </div>
        </div>
        {(() => {
          const overflows = selected.map(target => {
            const type = (target.type || target.platformName || '').toLowerCase();
            const limit = type.includes('twitter') || type.includes('x') ? 280
              : type.includes('threads') ? 500
              : type.includes('instagram') ? 2200
              : type.includes('tiktok') ? 2200
              : type.includes('linkedin') ? 3000
              : 63206;
            const overBy = message.length - limit;
            return { target, limit, overBy, isOver: overBy > 0 };
          }).filter(item => item.isOver);
          if (!overflows.length) return null;
          return (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
              {overflows.map(item => (
                <span key={item.target.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 650, color: 'var(--danger)', background: 'var(--danger-soft)', padding: '2px 8px', borderRadius: '4px' }}>
                  ⚠️ {channelName(item.target)}: {item.overBy} chars over {item.limit} limit
                </span>
              ))}
            </div>
          );
        })()}
        {hookAnalysis && hookScorerOpen && (
          <div className={styles.hookPanel}>
            <div className={styles.hookHead}>
              <strong>{cc.createHookScore}</strong>
              <button type="button" className={styles.addRow} onClick={() => setHookScorerOpen(false)}>{cc.createHookDismiss}</button>
            </div>
            <ul className={styles.hookChecks}>{hookAnalysis.checks.map(check => <li key={check.text} data-ok={check.ok || undefined}>{check.ok ? <IconCheck size={14} aria-label={cc.createHookPass} /> : <IconAlertTriangle size={14} aria-label={cc.createHookFail} />} {check.text}</li>)}</ul>
            {aiStatus?.available && hookAnalysis.firstLine ? <div className={styles.hookRewrite}>
              {hookAnalysis.rewrite ? <><span>{hookAnalysis.rewrite}</span><Button type="button" variant="secondary" size="sm" onClick={() => applyHookAlternative(hookAnalysis.rewrite!)}>{cc.createHookApply}</Button></>
                : <Button type="button" variant="secondary" size="sm" busy={hookAnalysis.rewriting} disabled={hookAnalysis.rewriting} onClick={() => void rewriteHook()}>{cc.createHookRewrite}</Button>}
              {hookAnalysis.error ? <p role="alert">{hookAnalysis.error}</p> : null}
            </div> : null}
          </div>
        )}
      </section>
      <section className={styles.section} aria-labelledby={`${titleId}-media`}>
        <div className={styles.sectionHead}><h2 id={`${titleId}-media`}>{cc.createMedia}</h2></div>
        <PostAttachments controller={attachments} disabled={busy} onPickLibrary={() => setLibraryOpen(true)} {...(aiStatus?.available && aiStatus.altText ? { altTextAssist: { locale: aiLocale } } : {})} />
        <label className={styles.linkField} htmlFor="composer-link"><span>{ui.link}</span>
          <input id="composer-link" name="link" type="url" disabled={busy} value={link} onChange={event => setLink(event.currentTarget.value)} placeholder={ui.linkPlaceholder} />
        </label>
        <LinkPreviewCard link={link} locale={aiLocale} disabled={busy} copyCatalog={copyCatalog} />
        <small className={styles.help}>{ui.attachmentSupport}</small>
      </section>
      <section className={styles.section} aria-labelledby={`${titleId}-languages`}>
        <div className={styles.sectionHead}><h2 id={`${titleId}-languages`}>{variantCopy.title}</h2></div>
        {draftPostId ? <PostVariantsEditor postId={draftPostId} locale={aiLocale} copyCatalog={copyCatalog} /> : <p className={styles.help}>{variantCopy.needDraft}</p>}
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

      <fieldset className={styles.group} disabled={busy}>
        <legend className="ui-visually-hidden">{text.scheduling}</legend>
        {mode === 'schedule' && remoteScheduling?.offered && holdable.length > 0 && <div className={styles.holdChoice}>
          <strong id="composer-hold-legend">{text.whoSends}</strong>
          <RadioCards legend={holdCopy.legend} name="scheduleMode" value={scheduleMode} onChange={value => setScheduleMode(value === 'remote' ? 'remote' : 'application')} options={[
            { value: 'application', label: text.holdApp, description: text.holdAppHint },
            { value: 'remote', label: text.holdPlatform(holdablePlatforms || text.platformFallback), description: `${text.holdPlatformHint(holdablePlatforms || text.platformFallback)} ${holdCopy.window.replace('{min}', holdWindow.min).replace('{max}', holdWindow.max)}` },
          ]} />
        </div>}
        <input type="hidden" name="destinationScheduleModesJson" value={destinationScheduleModesJson} />
        {mode === 'schedule' && remoteScheduling?.offered && holdable.length > 0 && <ul className={styles.destinationModes} aria-label={text.whoSends}>
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
        {mode === 'schedule' && remoteScheduling?.offered && scheduleMode === 'remote' && appOnly.length > 0 && <small role="status">{holdCopy.appOnly.replace('{names}', appOnly.map(target => target.name).join(', '))}</small>}
      </fieldset>

      <details className={styles.advanced}>
        <summary><IconChevronDown size={16} aria-hidden="true" />{cc.createAdvanced}</summary>
        <div className={styles.advancedBody}>
        {labels.length > 0 && <fieldset className={styles.group} disabled={busy}>
          <label className={styles.linkField} htmlFor="composer-label"><span>{cc.createAdvancedLabel}</span>
            <select id="composer-label" value={labelId} disabled={saved} onChange={event => setLabelId(event.currentTarget.value)}>
              <option value="">{cc.createAdvancedNoLabel}</option>
              {labels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}
            </select></label>
        </fieldset>}
        {selected.some(target => target.publishingFormats?.length) && <fieldset className={styles.group} disabled={busy}>
          <legend>{cc.createAdvancedFormats}</legend>
          <DestinationFormats copyCatalog={copyCatalog} locale={aiLocale} targets={targets} selectedIds={selected.map(target => target.id)} values={formatChoices} formId={FORM_ID} disabled={busy} onChange={(id, value) => setFormatChoices(current => ({ ...current, [id]: value }))} />
        </fieldset>}
        </div>
      </details>
    </form>

    <aside className={styles.preview} aria-labelledby={`${titleId}-preview`}>
      <div className={styles.sectionHead}><h2 id={`${titleId}-preview`}>{cc.createPreviewTitle}</h2><InfoTip name={cc.createPreviewTitle}>{cc.createPreviewInfo}</InfoTip><span className={styles.sectionMeta}>{saved ? ui.savedPreview : ui.unsavedPreview}</span></div>
      <ChannelPreviewTabs recentPosts={recentPosts.filter(post => post.targetIds.some(id => selectedTargets.includes(id))).slice(0, 8)} channels={selected.map(target => ({ ...target, displayName: channelName(target) }))} formats={formatChoices} previewPost={previewPost} attachments={attachments} timeZone={schedule.timeZone} locale={aiLocale} authorFallback={authorName || ui.yourTeam} value={previewChannelId || 'all'} onChange={id => setPreviewChannelId(id === 'all' ? '' : id)} />
      {mode === 'schedule' && hasTime && <p className={styles.timeNote}><IconCalendarEvent size={15} aria-hidden="true" />{fillComposerCopy(ui.schedulePreview, { date: scheduleDate, time: scheduleTime, zone: schedule.timeZone.replaceAll('_', ' ') })}</p>}
      {mode === 'queue' && queueReady && typeof queuePreview === 'object' && queuePreview?.status === 'ready' && <p className={styles.timeNote}><IconCalendarEvent size={15} aria-hidden="true" />{fill(copy.next, { time: queuePreview.scheduledLabel })} <small>{copy.estimate}</small></p>}
    </aside>
    </div>

    <ActionBar label={cc.createActionBar} status={status}>
      <div className={styles.shortcutHints}>
        {hasTime && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}><kbd className="ui-kbd">⌘</kbd><kbd className="ui-kbd">↵</kbd> {cc.createSchedule}</span>}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}><kbd className="ui-kbd">⌘</kbd><kbd className="ui-kbd">S</kbd> {cc.createSaveDraft}</span>
      </div>
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
  </div></>;
}

export function PostComposer(props: Parameters<typeof PostComposerContent>[0]) {
  return <ComposerCopyProvider catalog={props.copyCatalog ?? composerCatalogDefaults} locale={props.aiLocale ?? 'en'}><PostComposerContent {...props} /></ComposerCopyProvider>;
}
