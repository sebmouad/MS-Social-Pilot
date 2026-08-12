'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { TargetPicker, type TargetOption } from './TargetPicker';
import { AiAssist } from './AiAssist';
import type { LinkPreview, PostMedia } from '@/lib/json';
import { LIMITS } from '@/lib/constants';

interface Props {
  targets: TargetOption[];
  timezone: string;
  hasQueueSlots: boolean;
  /** Local `datetime-local` value one hour from now, computed on the server. */
  defaultScheduledAt: string;
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

type Timing = 'now' | 'schedule' | 'queue';
type Handler = 'worker' | 'native';

export function Composer({
  targets,
  timezone,
  hasQueueSlots,
  defaultScheduledAt,
  aiEnabled,
  requiresApproval,
  canPublishDirectly,
  editing,
}: Props) {
  const t = useTranslations('compose');
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
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

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
    for (const file of Array.from(files).slice(0, LIMITS.mediaPerPost - media.length)) {
      const form = new FormData();
      form.set('file', file);

      const response = await fetch('/api/media', { method: 'POST', body: form });
      const body = (await response.json()) as PostMedia & { error?: string };

      if (!response.ok) {
        setError(body.error ?? `${file.name}: ${body.error ?? ''}`.trim());
        continue;
      }
      setMedia((current) => [...current, body]);
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(saveAsDraft: boolean) {
    setPending(true);
    setError(null);
    setResult(null);

    const publishMode = timing === 'now' ? 'immediate' : handler;

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
            publishMode: handler,
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
      results?: Array<{ targetName: string; status: string; error?: string }>;
    };

    if (!response.ok) {
      const fieldError = body.fields ? Object.values(body.fields)[0] : undefined;
      setError(fieldError ?? body.error ?? t('couldNotSave'));
      setPending(false);
      return;
    }

    const failures = (body.results ?? []).filter((item) => item.status === 'failed');
    if (failures.length > 0) {
      setError(
        t('publishedWithProblems', {
          details: failures
            .map((failure) => `${failure.targetName} — ${failure.error ?? ''}`.trim())
            .join('; '),
        }),
      );
      setPending(false);
      router.refresh();
      return;
    }

    // Editing ends by going back to the list the Edit button came from, where
    // the changed row is on screen. Emptying the form and staying put would
    // look like the post had been thrown away.
    if (editing) {
      router.push('/posts');
      router.refresh();
      return;
    }

    setResult(
      saveAsDraft
        ? t('savedDraft')
        : needsApproval
          ? t('submittedOk')
          : timing === 'now'
            ? t('publishedOk')
            : t('scheduledOk'),
    );
    writeMessage('');
    writeLink('');
    setPreview(null);
    setMedia([]);
    setPending(false);
    router.refresh();
  }

  // A contributor in a workspace with approval on is submitting, not
  // scheduling, and the button must say so.
  const needsApproval = requiresApproval && !canPublishDirectly;

  const canSubmit =
    !pending && selected.length > 0 && (message.trim().length > 0 || link.trim().length > 0 || media.length > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
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
          <p className="hint">{t('characters', { count: message.length })}</p>

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
            <input
              id="media"
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
              onChange={(event) => event.target.files && uploadFiles(event.target.files)}
            />
            <p className="hint">{t('mediaHint', { max: LIMITS.mediaPerPost })}</p>

            {media.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {media.map((item) => (
                  <li key={item.id} className="relative">
                    {item.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
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
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="space-y-6">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('whereToPost')}</h2>
          <TargetPicker targets={targets} selected={selected} onChange={setSelected} />
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

              <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-700">{t('whoHolds')}</p>
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <input
                    type="radio"
                    name="handler"
                    className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-brand-500"
                    checked={handler === 'worker'}
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
                    checked={handler === 'native'}
                    disabled={hasGroupSelected}
                    onChange={() => setHandler('native')}
                  />
                  <span>
                    <strong className="font-medium text-slate-800">{t('facebook')}</strong>{' '}
                    {t('facebookHint')}
                    {hasGroupSelected && t('facebookGroupWarning')}.
                  </span>
                </label>
              </div>
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {result}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={!canSubmit} onClick={() => submit(false)}>
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
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => submit(true)}>
            {editing ? t('moveToDrafts') : t('saveDraft')}
          </button>
        </div>
      </div>
    </div>
  );
}
