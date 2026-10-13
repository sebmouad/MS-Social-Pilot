'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface VideoRow {
  id: string;
  prompt: string;
  aspectRatio: string;
  status: 'working' | 'ready' | 'failed';
  mediaId: string | null;
  error: string | null;
}

/** A video from a description: it takes a few minutes, so the list says where each one is. */
export function AiVideoPanel({ initial }: { initial: VideoRow[] }) {
  const t = useTranslations('design.video');
  const tCommon = useTranslations('common');
  const [videos, setVideos] = useState(initial);
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('9:16');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = videos.some((video) => video.status === 'working');

  async function reload() {
    const response = await fetch('/api/ai/video').catch(() => null);
    if (response?.ok) setVideos(((await response.json()) as { videos: VideoRow[] }).videos);
  }

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function start() {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/ai/video', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, aspectRatio: aspect }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      return setError(body?.error ?? tCommon('genericError'));
    }
    setPrompt('');
    await reload();
  }

  return (
    <section className="card space-y-3 p-4" aria-labelledby="ai-video-title">
      <h2 id="ai-video-title" className="text-[15px] font-semibold text-slate-900">
        {t('title')}
      </h2>
      <label className="label" htmlFor="ai-video-prompt">
        {t('prompt')}
      </label>
      <textarea id="ai-video-prompt" className="input" rows={2} maxLength={1000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('placeholder')} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="segmented" role="radiogroup" aria-label={t('shape')}>
          {(['9:16', '16:9'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={aspect === value} className={`segmented-item ${aspect === value ? 'segmented-item-active' : ''}`} onClick={() => setAspect(value)}>
              {value === '9:16' ? t('tall') : t('wide')}
            </button>
          ))}
        </div>
        <button type="button" className="btn-secondary" disabled={busy || prompt.trim().length < 3} onClick={() => void start()}>
          {busy ? t('starting') : t('start')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <p className="hint">{t('hint')}</p>
      {videos.length > 0 && (
        <ul className="divide-y divide-slate-100" aria-label={t('list')}>
          {videos.map((video) => (
            <li key={video.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-700">{video.prompt}</span>
              {video.status === 'working' && <span className="badge">{t('working')}</span>}
              {video.status === 'failed' && <span className="text-red-700">{video.error ?? t('failed')}</span>}
              {video.status === 'ready' && video.mediaId && (
                <a className="font-semibold text-brand-600 hover:underline" href={`/api/media/${video.mediaId}/raw`} target="_blank" rel="noreferrer">
                  {t('open')}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
