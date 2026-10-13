'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { VOICE_NAMES } from '@/lib/voice-names';

/** A text read aloud: play it, or download the MP3 (a Facebook post cannot carry audio alone). */
export function AiVoicePanel() {
  const t = useTranslations('design.voice');
  const tCommon = useTranslations('common');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<string>(VOICE_NAMES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<string | null>(null);

  useEffect(() => () => {
    if (audio) URL.revokeObjectURL(audio);
  }, [audio]);

  async function speak() {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/ai/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      return setError(body?.error ?? tCommon('genericError'));
    }
    setAudio(URL.createObjectURL(await response.blob()));
  }

  return (
    <section className="card space-y-3 p-4" aria-labelledby="ai-voice-title">
      <h2 id="ai-voice-title" className="text-[15px] font-semibold text-slate-900">
        {t('title')}
      </h2>
      <label className="label" htmlFor="ai-voice-text">
        {t('text')}
      </label>
      <textarea id="ai-voice-text" className="input" rows={3} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder={t('placeholder')} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="ai-voice-voice">
            {t('voice')}
          </label>
          <select id="ai-voice-voice" className="input" value={voice} onChange={(event) => setVoice(event.target.value)}>
            {VOICE_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-secondary" disabled={busy || text.trim().length < 3} onClick={() => void speak()}>
          {busy ? t('working') : t('start')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {audio && (
        <div className="flex flex-wrap items-center gap-3">
          <audio controls src={audio} aria-label={t('player')} />
          <a className="font-semibold text-brand-600 hover:underline" href={audio} download="voice-over.mp3">
            {t('download')}
          </a>
        </div>
      )}
      <p className="hint">{t('hint')}</p>
    </section>
  );
}
