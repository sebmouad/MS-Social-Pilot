'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { TargetPicker, type TargetOption } from './TargetPicker';
import { ExternalLink } from './ExternalLink';
import { AiAssist } from './AiAssist';
import { Icon } from './Icon';
import { PostPreview } from './PostPreview';
import type { LinkPreview, PostMedia } from '@/lib/json';
import { LIMITS } from '@/lib/constants';
import { countCharacters } from '@/lib/text';
import { formatInZone } from '@/lib/time';
import { IG_CAPTION_LIMIT } from '@/lib/constants';

interface Props {
  targets: TargetOption[];
  timezone: string;
  hasQueueSlots: boolean;
  /** Local `datetime-local` value one hour from now, computed on the server. */
  defaultScheduledAt: string;
  /** This week's times the workspace's Pages have done best at, soonest first. */
  goodTimes?: GoodTime[];
  /** Hidden entirely when the server has no API key or the client opted out. */
  aiEnabled: boolean;
  /** True when this workspace holds posts for review. */
  requiresApproval: boolean;
  /** False for contributors, who can only submit for approval. */
  canPublishDirectly: boolean;
  /**
   * An existing post this screen is editing rather than writing.
   *
   * Absent for a new post, which is the usual case. When present every field
   * starts from the stored post and saving sends a PATCH: the same screen, so
   * that editing offers exactly what composing does — the alternative was
   * cancelling the post and typing it again.
   */
  editing?: EditingPost;
}

export interface EditingPost {
  id: string;
  message: string;
  link: string | null;
  media: PostMedia[];
  targetIds: string[];
  /** `datetime-local` value in the workspace's zone, or null for a draft. */
  scheduledAtLocal: string | null;
  publishMode: string;
}

export interface GoodTime {
  /** `datetime-local` value in the workspace's zone. */
  value: string;
  label: string;
  /** Average interactions against each Page's typical post: 1 is typical. */
  lift: number;
  posts: number;
}

/** The parts of an attachment list an author can change, for spotting edits. */
const mediaKey = (media: PostMedia[]) => media.map((item) => `${item.id}:${item.altText ?? ''}`).join('|');

type Timing = 'now' | 'schedule' | 'queue';
type Handler = 'worker' | 'native';

export function Composer({
  targets,
  timezone,
  hasQueueSlots,
  defaultScheduledAt,
  goodTimes = [],
  aiEnabled,
  requiresApproval,
  canPublishDirectly,
  editing,
}: Props) {
  const t = useTranslations('compose');
  // Passed explicitly: this runs in the browser, outside the server request
  // that sets the date language for everything else.
  const locale = useLocale();
  const tCommon = useTranslations('common');
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const messageBox = useRef<HTMLTextAreaElement>(null);
  const linkBox = useRef<HTMLInputElement>(null);

  const [message, setMessage] = useState(editing?.message ?? '');
  const [link, setLink] = useState(editing?.link ?? '');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [media, setMedia] = useState<PostMedia[]>(editing?.media ?? []);
  const [selected, setSelected] = useState<string[]>(editing?.targetIds ?? []);
  const [timing, setTiming] = useState<Timing>('schedule');
  const [handler, setHandler] = useState<Handler>(
    editing?.publishMode === 'native' ? 'native' : 'worker',
  );
  const [scheduledAt, setScheduledAt] = useState(
    editing?.scheduledAtLocal ?? defaultScheduledAt,
  );
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  /** Permalinks for a post that has just gone out, so it can be checked. */
  const [published, setPublished] = useState<Array<{ name: string; url: string }>>([]);
  /** A post that was made but reached only some of its destinations. */
  const [partial, setPartial] = useState<{ text: string; allFailed: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);

  /**
   * Keep the two text boxes uncontrolled, and read them once on mount.
   *
   * They used to be controlled by `message` and `link`. That is fine once React
   * is running and wrong for the second before it is: the page paints, someone
   * starts typing straight into the box — it is the first thing on the screen
   * and the cursor is already in it — and hydration then resets the field to
   * the empty string it was rendered with. The first words of the post
   * disappear as they are typed.
   *
   * Uncontrolled fields survive hydration untouched, so the only thing missing
   * afterwards is the state, which this picks up.
   */
  useEffect(() => {
    const typed = messageBox.current?.value ?? '';
    if (typed) setMessage(typed);

    const pasted = linkBox.current?.value ?? '';
    if (pasted) {
      setLink(pasted);
      void loadPreview(pasted);
    }
    // Once, on mount: after this the change handlers keep both in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Put text in the box from code rather than from the keyboard.
   *
   * The box is uncontrolled, so setting the state alone would leave what is on
   * screen unchanged — the AI suggestion would be accepted and invisible, and
   * the box would still hold the last post after a successful send.
   */
  const writeMessage = useCallback((text: string) => {
    setMessage(text);
    if (messageBox.current) messageBox.current.value = text;
  }, []);

  const writeLink = useCallback((text: string) => {
    setLink(text);
    if (linkBox.current) linkBox.current.value = text;
  }, []);

  const selectedTargets = targets.filter((target) => selected.includes(target.id));
  const hasGroupSelected = selectedTargets.some((target) => target.type === 'group');
  const hasInstagramSelected = selectedTargets.some((target) => target.type === 'instagram');
  // Facebook's own scheduler holds Page posts only: a Group has no such API
  // and Instagram's publishes on the spot. Rather than let the choice stand
  // and have the server refuse it, the app takes over while either is ticked.
  const nativeBlocked = hasGroupSelected || hasInstagramSelected;
  const effectiveHandler: Handler = nativeBlocked ? 'worker' : handler;
  // Instagram has no text-only post; said now rather than at the scheduled
  // moment. A draft can still be saved while the picture is found.
  const instagramNeedsMedia = hasInstagramSelected && media.length === 0;
  // A destination switched off since this post was written stays ticked so
  // the author sees it, but the server will not accept it; say which to untick.
  const switchedOff = selectedTargets.filter((target) => !target.canPublish);

  /**
   * Whether leaving now would lose something.
   *
   * A new post counts as unsaved once it has any content; an edit, once it
   * differs from what was loaded. Destinations and time alone do not count on
   * a new post — they are two clicks to redo, and warning over them would make
   * the guard fire on every visit.
   */
  const dirty = editing
    ? message !== editing.message ||
      link !== (editing.link ?? '') ||
      mediaKey(media) !== mediaKey(editing.media) ||
      [...selected].sort().join() !== [...editing.targetIds].sort().join() ||
      scheduledAt !== (editing.scheduledAtLocal ?? defaultScheduledAt)
    : message.trim().length > 0 || link.trim().length > 0 || media.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show the prompt only when this is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const loadPreview = useCallback(
    async (url: string, refresh = false) => {
      if (!url.trim()) {
        setPreview(null);
        return;
      }
      setPreviewLoading(true);
      try {
        const response = await fetch('/api/link-preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, refresh }),
        });
        const body = (await response.json()) as { preview?: LinkPreview; error?: string };
        setPreview(response.ok ? body.preview ?? null : null);
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [],
  );

  async function uploadFiles(files: FileList) {
    setError(null);
    setUploading(true);
    // Every refusal names its file. Several can go wrong in one pick, and
    // "File too large" on its own leaves the author guessing which one.
    const problems: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, LIMITS.mediaPerPost - media.length)) {
        const form = new FormData();
        form.set('file', file);

        try {
          const response = await fetch('/api/media', { method: 'POST', body: form });
          const body = (await response.json().catch(() => ({}))) as PostMedia & { error?: string };
          if (!response.ok) {
            problems.push(`${file.name}: ${body.error ?? t('uploadFailed')}`);
            continue;
          }
          setMedia((current) => [...current, body]);
        } catch {
          problems.push(`${file.name}: ${t('uploadFailed')}`);
        }
      }
    } finally {
      if (problems.length > 0) setError(problems.join(' · '));
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function setAltText(id: string, altText: string) {
    setMedia((current) =>
      current.map((item) => (item.id === id ? { ...item, altText: altText || undefined } : item)),
    );
  }

  async function submit(saveAsDraft: boolean) {
    setPending(true);
    setError(null);
    setResult(null);
    setPartial(null);
    setPublished([]);

    const publishMode = timing === 'now' ? 'immediate' : effectiveHandler;

    try {
      // Editing takes a narrower route on purpose. "Publish now" and the queue
      // are ways of *starting* a post; a post that already exists has a place in
      // the calendar, and the thing being changed here is its content and when
      // it goes out.
      const response = editing
        ? await fetch(`/api/posts/${editing.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              message,
              link: link.trim() ? link.trim() : null,
              media,
              targetIds: selected,
              publishMode: effectiveHandler,
              scheduledAtLocal: saveAsDraft ? null : scheduledAt,
              timezone,
            }),
          })
        : await fetch('/api/posts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              message,
              link: link.trim() ? link.trim() : null,
              media,
              targetIds: selected,
              publishMode,
              scheduledAtLocal: timing === 'schedule' ? scheduledAt : null,
              timezone,
              useQueue: timing === 'queue',
              saveAsDraft,
            }),
          });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
        postId?: string;
        scheduledAt?: string | null;
        notice?: string;
        results?: Array<{ targetName: string; status: string; url?: string; error?: string }>;
      };

      if (!response.ok) {
        const fieldError = body.fields ? Object.values(body.fields)[0] : undefined;
        setError(fieldError ?? body.error ?? t('couldNotSave'));
        return;
      }

      // Editing ends by going back to the list the Edit button came from, where
      // the changed row is on screen. Emptying the form and staying put would
      // look like the post had been thrown away.
      //
      // Unless the save came back with something to say — Facebook would have
      // refused the time, so this app holds the post instead. The list would
      // not repeat that, so it is said here, with the way on to the list.
      if (editing && body.notice) {
        setResult(body.notice);
        // What the server did, so saving again does not ask for it once more.
        setHandler('worker');
        router.refresh();
        return;
      }
      if (editing) {
        router.push('/posts');
        router.refresh();
        return;
      }

      // From here on the post exists, whatever happened to its destinations,
      // so the form is emptied either way. Leaving it filled after a partial
      // failure invited pressing the button again — which made a second post
      // and published it a second time to every Page that had worked.
      setPublished(
        (body.results ?? [])
          .filter((item) => item.status === 'published' && item.url)
          .map((item) => ({ name: item.targetName, url: item.url! })),
      );
      writeMessage('');
      writeLink('');
      setPreview(null);
      setMedia([]);
      router.refresh();

      const failures = (body.results ?? []).filter((item) => item.status === 'failed');
      if (failures.length > 0) {
        setPartial({
          text: t('publishedWithProblems', {
            details: failures
              .map((failure) => `${failure.targetName} — ${failure.error ?? ''}`.trim())
              .join('; '),
          }),
          allFailed: failures.length === (body.results ?? []).length,
        });
        return;
      }

      // The queue picks the time on the server, so this is the only place the
      // author is told which slot they got. "Scheduled" on its own leaves them
      // to go and find out.
      const queuedFor =
        timing === 'queue' && body.scheduledAt
          ? formatInZone(new Date(body.scheduledAt), timezone, undefined, locale)
          : null;

      setResult(
        saveAsDraft
          ? t('savedDraft')
          : needsApproval
            ? t('submittedOk')
            : timing === 'now'
              ? t('publishedOk')
              : queuedFor
                ? t('queuedOk', { when: queuedFor })
                : t('scheduledOk'),
      );
    } catch {
      setError(t('couldNotSave'));
    } finally {
      setPending(false);
    }
  }

  // A contributor in a workspace with approval on is submitting, not
  // scheduling, and the button must say so.
  const needsApproval = requiresApproval && !canPublishDirectly;

  const hasContent = message.trim().length > 0 || link.trim().length > 0 || media.length > 0;
  const canSubmit =
    !pending && !uploading && selected.length > 0 && hasContent && !instagramNeedsMedia;

  // A greyed-out button with no reason reads as broken. Say what is missing,
  // in the order someone would fix it.
  const blocker = pending
    ? null
    : uploading
      ? t('uploading')
      : targets.length === 0
        ? t('blockedNoDestinations')
        : selected.length === 0
          ? t('blockedNoneSelected')
          : !hasContent
            ? t('blockedNoContent')
            : instagramNeedsMedia
              ? t('blockedInstagramMedia')
              : null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* `min-w-0` on both columns, and it is load-bearing. A grid track sizes
          itself to its content's minimum width, and a destination row carrying
          a long name, an account and the note saying why it is switched off
          has a wide one — so without this the column grows past the screen on a
          phone and every other column stretches to match. `truncate` does not
          help: like `overflow-wrap: break-word`, it clips what is painted
          without reducing the width the box asks for. */}
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <section className="card p-5">
          <label className="label" htmlFor="message">
            {t('whatToSay')}
          </label>
          <textarea
            id="message"
            ref={messageBox}
            className="input min-h-[160px] resize-y"
            placeholder={t('placeholder')}
            defaultValue={editing?.message ?? ''}
            maxLength={LIMITS.messageLength}
            onChange={(event) => setMessage(event.target.value)}
          />
          {/* What a person means by a character: one emoji is one, not two. */}
          <p className="hint">{t('characters', { count: countCharacters(message) })}</p>

          {/* Instagram's limit is a fifth of Facebook's and genuinely
              reachable. Said here rather than discovered at the scheduled
              moment, hours later, as a failed destination on the post list. */}
          {hasInstagramSelected && countCharacters(message) > IG_CAPTION_LIMIT && (
            <p className="mt-1 text-xs text-amber-700">
              {t('instagramTooLong', {
                count: countCharacters(message),
                limit: IG_CAPTION_LIMIT,
              })}
            </p>
          )}

          {aiEnabled && <AiAssist draft={message} onResult={writeMessage} />}

          <div className="mt-5">
            <label className="label" htmlFor="link">
              {t('link')} <span className="font-normal text-slate-400">{tAuth('optional')}</span>
            </label>
            <div className="flex gap-2">
              <input
                id="link"
                ref={linkBox}
                className="input"
                placeholder={t('linkPlaceholder')}
                defaultValue={editing?.link ?? ''}
                onChange={(event) => setLink(event.target.value)}
                onBlur={(event) => loadPreview(event.target.value)}
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={!link.trim() || previewLoading}
                onClick={() => loadPreview(link, true)}
                title={t('linkHint')}
              >
                {previewLoading ? t('reading') : t('refreshCard')}
              </button>
            </div>
            <p className="hint">{t('linkHint')}</p>

            {preview && (
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                {preview.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.imageUrl} alt="" className="h-40 w-full object-cover" />
                )}
                <div className="space-y-1 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    {preview.siteName ?? new URL(preview.url).hostname}
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {preview.title ?? t('noTitleFound')}
                  </p>
                  {preview.description && (
                    <p className="line-clamp-2 [overflow-wrap:anywhere] text-sm text-slate-600">{preview.description}</p>
                  )}
                  <p className="text-xs text-slate-400">
                    {t('readVia', {
                      source: preview.source === 'graph' ? t('viaGraph') : t('viaHtml'),
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5">
            <label className="label" htmlFor="media">
              {t('media')}
            </label>
            {/* The browser's own "Choose Files / No file chosen" control looked
                like no other control here. The input stays — visually hidden,
                still focusable and labelled — and the zone is its label, so a
                click, a keypress or a dropped file all reach the same handler. */}
            <input
              id="media"
              ref={fileInput}
              type="file"
              multiple
              // One batch at a time: a second pick mid-upload would count
              // against a stale total and could run past the per-post limit.
              disabled={uploading}
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
              className="peer sr-only"
              onChange={(event) => event.target.files && uploadFiles(event.target.files)}
            />
            <label
              htmlFor="media"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!uploading && event.dataTransfer.files.length > 0) uploadFiles(event.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 ${
                dragging
                  ? 'border-brand-400 bg-brand-50 text-brand-700'
                  : 'border-slate-300 text-slate-600 hover:border-brand-300 hover:bg-slate-50'
              }`}
            >
              <Icon name="image" size={20} className="text-slate-400" />
              <span>
                <span className="font-medium text-brand-600">{t('mediaChoose')}</span> {t('mediaOrDrop')}
              </span>
            </label>
            <p className="hint">{uploading ? t('uploading') : t('mediaHint', { max: LIMITS.mediaPerPost })}</p>

            {media.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-3">
                {media.map((item, index) => (
                  <li key={item.id} className="w-28">
                    <div className="relative h-20 w-20">
                      {item.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.url}
                          alt={item.altText ?? ''}
                          className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <span className="flex h-20 w-20 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-600">
                          {t('video')}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={t('removeAttachment')}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs text-white"
                        onClick={() => setMedia((current) => current.filter((entry) => entry.id !== item.id))}
                      >
                        ×
                      </button>
                    </div>
                    {/* A description for people using screen readers, kept
                        with the picture it describes. Only photos ask for one:
                        a video carries its own captions. */}
                    {item.kind === 'image' && (
                      <input
                        className="input mt-1.5 px-2 py-1 text-xs"
                        placeholder={t('altText')}
                        aria-label={t('altTextFor', { number: index + 1 })}
                        maxLength={1000}
                        value={item.altText ?? ''}
                        onChange={(event) => setAltText(item.id, event.target.value)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <PostPreview
          page={selectedTargets[0] ?? null}
          message={message}
          media={media}
          link={preview}
          timing={timing}
          scheduledAt={scheduledAt}
        />
      </div>

      <div className="min-w-0 space-y-6">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('whereToPost')}</h2>
          <TargetPicker targets={targets} selected={selected} onChange={setSelected} />
          {switchedOff.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              {t('untickSwitchedOff', { names: switchedOff.map((target) => target.name).join(', ') })}
            </p>
          )}
          {instagramNeedsMedia && (
            <p className="mt-2 text-xs text-amber-700" role="status">
              {t('instagramNeedsMedia')}
            </p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('whenToPost')}</h2>

          <div className="space-y-2">
            {(
              editing
                ? ([['schedule', t('scheduleForTime')]] as Array<[Timing, string]>)
                : ([
                    ['now', t('publishNow')],
                    ['schedule', t('scheduleForTime')],
                    ['queue', t('addToQueue')],
                  ] as Array<[Timing, string]>)
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="timing"
                  className="h-4 w-4 border-slate-300 text-brand-500 focus:ring-brand-500"
                  checked={timing === value}
                  disabled={value === 'queue' && !hasQueueSlots}
                  onChange={() => setTiming(value)}
                />
                {label}
                {value === 'queue' && !hasQueueSlots && (
                  <span className="text-xs text-slate-400">{t('queueNotSetUp')}</span>
                )}
              </label>
            ))}
          </div>

          {timing === 'schedule' && (
            <div className="mt-4">
              <label className="label" htmlFor="scheduledAt">
                {t('dateAndTime')}
              </label>
              <input
                id="scheduledAt"
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
              <p className="hint">{t('timezoneHint', { timezone })}</p>

              {goodTimes.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-slate-700" id="good-times-label">
                    {t('goodTimes')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-labelledby="good-times-label">
                    {goodTimes.map((time) => (
                      <button
                        key={time.value}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          scheduledAt === time.value
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'
                        }`}
                        aria-pressed={scheduledAt === time.value}
                        title={t('goodTimeTitle', { lift: time.lift.toLocaleString(locale), posts: time.posts })}
                        onClick={() => setScheduledAt(time.value)}
                      >
                        {time.label}
                      </button>
                    ))}
                  </div>
                  <p className="hint">{t('goodTimesHint')}</p>
                </div>
              )}

              <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-700">{t('whoHolds')}</p>
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <input
                    type="radio"
                    name="handler"
                    className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-brand-500"
                    checked={effectiveHandler === 'worker'}
                    onChange={() => setHandler('worker')}
                  />
                  <span>
                    <strong className="font-medium text-slate-800">{t('thisApp')}</strong>{' '}
                    {t('thisAppHint')}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <input
                    type="radio"
                    name="handler"
                    className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-brand-500"
                    checked={effectiveHandler === 'native'}
                    disabled={nativeBlocked}
                    onChange={() => setHandler('native')}
                  />
                  <span>
                    <strong className="font-medium text-slate-800">{t('facebook')}</strong>{' '}
                    {t('facebookHint')}
                    {hasGroupSelected
                      ? t('facebookGroupWarning')
                      : hasInstagramSelected
                        ? t('facebookInstagramWarning')
                        : ''}
                    .
                  </span>
                </label>
              </div>
            </div>
          )}
        </section>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 [overflow-wrap:anywhere]"
          >
            {error}
          </div>
        )}
        {(result || partial) && (
          <div
            role={partial ? 'alert' : 'status'}
            className={`rounded-lg border px-3 py-2 text-sm [overflow-wrap:anywhere] ${
              partial
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            <p>{partial?.text ?? result}</p>
            {editing && result && (
              <p className="mt-1">
                <Link href="/posts" className="font-medium underline underline-offset-2">
                  {t('openPostList')}
                </Link>
              </p>
            )}
            {/* Where to go from a failure: the post exists, and the list's
                "Retry failed" sends it to the missing destinations only. */}
            {partial && (
              <p className="mt-1">
                {partial.allFailed ? t('retryAllFromList') : t('retryFromList')}{' '}
                <Link href="/posts" className="font-medium underline underline-offset-2">
                  {t('openPostList')}
                </Link>
              </p>
            )}
            {/* The permalink comes back with the publish and is thrown away
                everywhere else. Right after posting is when somebody wants to
                look at what went out — telling them it worked and making them
                go and find it is the wrong half of the answer. */}
            {published.length > 0 && (
              <ul className="mt-2 space-y-1">
                {published.map((item) => (
                  <li key={item.url}>
                    <ExternalLink href={item.url} className="underline underline-offset-2">
                      {t('viewOn', { destination: item.name })}
                    </ExternalLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={!canSubmit}
              aria-describedby={blocker ? 'submit-blocker' : undefined}
              onClick={() => submit(false)}
            >
              {pending
                ? tCommon('working')
                : editing
                  ? t('saveChanges')
                  : needsApproval
                    ? t('submitForApproval')
                    : timing === 'now'
                      ? t('publishNow')
                      : t('schedule')}
            </button>
            <button type="button" className="btn-secondary" disabled={pending || uploading} onClick={() => submit(true)}>
              {editing ? t('moveToDrafts') : t('saveDraft')}
            </button>
          </div>
          {blocker && (
            <p id="submit-blocker" className="hint">
              {blocker}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
