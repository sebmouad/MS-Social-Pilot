'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { TargetPicker, type TargetOption } from './TargetPicker';
import type { LinkPreview, PostMedia } from '@/lib/json';
import { LIMITS } from '@/lib/constants';

interface Props {
  targets: TargetOption[];
  timezone: string;
  hasQueueSlots: boolean;
  /** Local `datetime-local` value one hour from now, computed on the server. */
  defaultScheduledAt: string;
}

type Timing = 'now' | 'schedule' | 'queue';
type Handler = 'worker' | 'native';

export function Composer({ targets, timezone, hasQueueSlots, defaultScheduledAt }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [media, setMedia] = useState<PostMedia[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [timing, setTiming] = useState<Timing>('schedule');
  const [handler, setHandler] = useState<Handler>('worker');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

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
        setError(body.error ?? `Could not upload ${file.name}.`);
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

    const response = await fetch('/api/posts', {
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
      setError(fieldError ?? body.error ?? 'Could not save this post.');
      setPending(false);
      return;
    }

    const failures = (body.results ?? []).filter((item) => item.status === 'failed');
    if (failures.length > 0) {
      setError(
        `Published with problems: ${failures
          .map((failure) => `${failure.targetName} — ${failure.error ?? 'failed'}`)
          .join('; ')}`,
      );
      setPending(false);
      router.refresh();
      return;
    }

    setResult(
      saveAsDraft
        ? 'Saved as a draft.'
        : timing === 'now'
          ? 'Published.'
          : 'Scheduled. You can see it on the calendar.',
    );
    setMessage('');
    setLink('');
    setPreview(null);
    setMedia([]);
    setPending(false);
    router.refresh();
  }

  const canSubmit =
    !pending && selected.length > 0 && (message.trim().length > 0 || link.trim().length > 0 || media.length > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="card p-5">
          <label className="label" htmlFor="message">
            What do you want to say?
          </label>
          <textarea
            id="message"
            className="input min-h-[160px] resize-y"
            placeholder="Write your post…"
            value={message}
            maxLength={LIMITS.messageLength}
            onChange={(event) => setMessage(event.target.value)}
          />
          <p className="hint">{message.length.toLocaleString()} characters</p>

          <div className="mt-5">
            <label className="label" htmlFor="link">
              Link <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                id="link"
                className="input"
                placeholder="https://example.com/article"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                onBlur={(event) => loadPreview(event.target.value)}
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={!link.trim() || previewLoading}
                onClick={() => loadPreview(link, true)}
                title="Ask Facebook to re-read this page's Open Graph tags"
              >
                {previewLoading ? 'Reading…' : 'Refresh card'}
              </button>
            </div>
            <p className="hint">
              Facebook builds the preview card from the page&apos;s Open Graph tags. Use “Refresh card” if
              you have just changed them.
            </p>

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
                  <p className="text-sm font-semibold text-slate-900">{preview.title ?? 'No title found'}</p>
                  {preview.description && (
                    <p className="line-clamp-2 text-sm text-slate-600">{preview.description}</p>
                  )}
                  <p className="text-xs text-slate-400">
                    Read via {preview.source === 'graph' ? 'the Facebook scraper' : 'a direct fetch'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5">
            <span className="label">Media</span>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
              onChange={(event) => event.target.files && uploadFiles(event.target.files)}
            />
            <p className="hint">
              Up to {LIMITS.mediaPerPost} photos, or one video. Facebook cannot mix a video with photos.
            </p>

            {media.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {media.map((item) => (
                  <li key={item.id} className="relative">
                    {item.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                    ) : (
                      <span className="flex h-20 w-20 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-600">
                        Video
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label="Remove attachment"
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
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Where to post</h2>
          <TargetPicker targets={targets} selected={selected} onChange={setSelected} />
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">When to post</h2>

          <div className="space-y-2">
            {(
              [
                ['now', 'Publish now'],
                ['schedule', 'Schedule for a specific time'],
                ['queue', 'Add to the next queue slot'],
              ] as Array<[Timing, string]>
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
                  <span className="text-xs text-slate-400">(set up times in Settings)</span>
                )}
              </label>
            ))}
          </div>

          {timing === 'schedule' && (
            <div className="mt-4">
              <label className="label" htmlFor="scheduledAt">
                Date and time
              </label>
              <input
                id="scheduledAt"
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
              <p className="hint">Times are in {timezone}, your workspace timezone.</p>

              <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-700">Who holds the post until then?</p>
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <input
                    type="radio"
                    name="handler"
                    className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-brand-500"
                    checked={handler === 'worker'}
                    onChange={() => setHandler('worker')}
                  />
                  <span>
                    <strong className="font-medium text-slate-800">This app.</strong> Editable until it goes
                    out, and works for groups.
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
                    <strong className="font-medium text-slate-800">Facebook.</strong> Publishes even if this
                    app is offline. Pages only, at least 10 minutes ahead
                    {hasGroupSelected && ', and unavailable while a group is selected'}.
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
            {pending ? 'Working…' : timing === 'now' ? 'Publish now' : 'Schedule'}
          </button>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => submit(true)}>
            Save draft
          </button>
        </div>
      </div>
    </div>
  );
}
