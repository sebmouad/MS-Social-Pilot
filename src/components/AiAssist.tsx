'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

const TONES = ['friendly', 'professional', 'playful', 'urgent', 'informative'] as const;

interface Props {
  /** Current composer text, used as the source for "Improve". */
  draft: string;
  onResult: (text: string) => void;
  /** The Pages picked: one lends its own brand voice. */
  targetIds?: string[];
  /** Put hashtags at the end of the post. */
  onHashtags?: (tags: string[]) => void;
}

/**
 * AI writing help.
 *
 * The result is shown as a suggestion the user explicitly accepts, rather than
 * being written straight into the composer. Silently replacing something
 * someone has typed is the fastest way to make a feature feel hostile.
 */
export function AiAssist({ draft, onResult, targetIds = [], onHashtags }: Props) {
  const t = useTranslations('compose');

  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState<string>('');
  const [pending, setPending] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  async function hashtags() {
    setPending(true);
    setError(null);
    setTags(null);
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'hashtags', text: draft, targetIds }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { hashtags?: string[]; error?: string } | undefined;
    setPending(false);
    if (!response?.ok) {
      setError(body?.error ?? t('aiUnavailable'));
      return;
    }
    const already = new Set((draft.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.toLowerCase()));
    const fresh = (body?.hashtags ?? []).filter((tag) => !already.has(tag.toLowerCase()));
    setTags(fresh);
    setPicked(fresh.slice(0, 5));
  }

  async function run(action: 'generate' | 'improve') {
    setPending(true);
    setError(null);
    setSuggestion(null);

    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        action === 'generate'
          ? { action, brief, targetIds, ...(tone ? { tone } : {}) }
          : { action, draft, targetIds, ...(tone ? { tone } : {}) },
      ),
    });

    const body = (await response.json().catch(() => ({}))) as {
      text?: string;
      error?: string;
      fields?: Record<string, string>;
    };

    if (!response.ok) {
      setError(body.fields ? Object.values(body.fields)[0]! : body.error ?? t('aiUnavailable'));
    } else {
      setSuggestion(body.text ?? '');
    }
    setPending(false);
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setOpen((value) => !value)}
        >
          ✨ {t('aiGenerate')}
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={pending || draft.trim().length < 3}
          onClick={() => run('improve')}
        >
          {pending ? t('aiThinking') : t('aiImprove')}
        </button>
        {onHashtags && (
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={pending || draft.trim().length < 3}
            onClick={() => void hashtags()}
          >
            # {t('aiHashtags')}
          </button>
        )}

        <select
          className="ms-auto input-sm"
          value={tone}
          onChange={(event) => setTone(event.target.value)}
          aria-label={t('aiTone')}
        >
          <option value="">{t('aiTone')}</option>
          {TONES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {open && (
        <div className="mt-3">
          <label className="label text-xs" htmlFor="aiBrief">
            {t('aiBrief')}
          </label>
          <div className="flex gap-2">
            <input
              id="aiBrief"
              className="input text-sm"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="20% off winter coats until Sunday"
            />
            <button
              type="button"
              className="btn-primary shrink-0 text-xs"
              disabled={pending || brief.trim().length < 3}
              onClick={() => run('generate')}
            >
              {pending ? t('aiThinking') : t('aiGenerate')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {tags && onHashtags && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          {tags.length === 0 ? (
            <p className="text-xs text-slate-500">{t('aiHashtagsNone')}</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">{t('aiHashtagsPick')}</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const on = picked.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={on}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        on ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                      onClick={() => setPicked(on ? picked.filter((value) => value !== tag) : [...picked, tag])}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={picked.length === 0}
                  onClick={() => {
                    onHashtags(picked);
                    setTags(null);
                  }}
                >
                  {t('aiHashtagsAdd', { count: picked.length })}
                </button>
                <button type="button" className="btn-secondary text-xs" onClick={() => setTags(null)}>
                  ✕
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {suggestion && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-800">{suggestion}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => {
                onResult(suggestion);
                setSuggestion(null);
                setOpen(false);
              }}
            >
              {t('aiInsert')}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setSuggestion(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
