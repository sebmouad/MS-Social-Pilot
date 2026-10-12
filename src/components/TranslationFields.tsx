'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import type { TranslationGroup } from '@/lib/translation';

import { Icon } from './Icon';

export type Translation = TranslationGroup & { rtl: boolean };

/**
 * AI translation (NEXT_PHASES G11): the post in each language the picked
 * Pages' audiences read, as one editable version per language. Pages with no
 * audience language keep the original. Nothing goes out until Schedule.
 */
export function TranslationFields({
  message,
  targetIds,
  pageNames,
  value,
  onChange,
}: {
  message: string;
  targetIds: string[];
  pageNames: Map<string, string>;
  value: Translation[] | null;
  onChange: (value: Translation[] | null) => void;
}) {
  const t = useTranslations('translate');
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState('');

  const languageName = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'language' });
    return (tag: string) => {
      try {
        return names.of(tag) ?? tag;
      } catch {
        return tag;
      }
    };
  }, [locale]);

  async function translate() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'translate', text: message, targetIds }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as
      | { translations?: Translation[]; error?: string; fields?: Record<string, string> }
      | undefined;
    setPending(false);
    if (!response?.ok) {
      setError((body?.fields && Object.values(body.fields)[0]) ?? body?.error ?? t('failed'));
      return;
    }
    const translations = body?.translations ?? [];
    if (!translations.some((translation) => translation.language)) {
      setError(t('noLanguages'));
      return;
    }
    setSource(message);
    onChange(translations);
  }

  if (!value) {
    return (
      <div className="mt-3">
        <button type="button" className="btn-secondary text-xs" disabled={pending || message.trim().length < 3} onClick={() => void translate()}>
          <Icon name="globe" size={14} />
          {pending ? t('working') : t('start')}
        </button>
        {error && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-labelledby="translations-title">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="translations-title" className="text-sm font-semibold text-slate-900">
          {t('title', { count: value.filter((translation) => translation.language).length })}
        </h3>
        <button type="button" className="ml-auto text-xs font-medium text-slate-600 hover:underline" onClick={() => onChange(null)}>
          {t('stop')}
        </button>
      </div>
      <p className="hint">{t('hint')}</p>
      {source !== message && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-800">
          {t('stale')}
          <button type="button" className="font-medium text-brand-600 hover:underline" disabled={pending} onClick={() => void translate()}>
            {pending ? t('working') : t('again')}
          </button>
        </p>
      )}
      <div className="mt-3 space-y-3">
        {value.map((translation, index) => {
          const id = `translation-${index}`;
          const pages = translation.targetIds.map((targetId) => pageNames.get(targetId) ?? targetId).join(', ');
          return (
            <div key={translation.language ?? 'original'}>
              <label className="label" htmlFor={id}>
                {translation.language ? `${languageName(translation.language)} (${translation.language})` : t('original')}
                <span className="block text-xs font-normal text-slate-500">{pages}</span>
              </label>
              {translation.language ? (
                <textarea
                  id={id}
                  className="input min-h-24"
                  dir={translation.rtl ? 'rtl' : 'ltr'}
                  lang={translation.language}
                  value={translation.text}
                  onChange={(event) =>
                    onChange(value.map((item, position) => (position === index ? { ...item, text: event.target.value } : item)))
                  }
                />
              ) : (
                <p id={id} className="hint">
                  {t('originalHint')}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
