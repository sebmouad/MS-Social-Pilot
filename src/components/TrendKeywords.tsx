'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** The team's words that keep trending topics to its subjects (H7). Admins edit; everyone reads. */
export function TrendKeywords({ keywords, canEdit }: { keywords: string[]; canEdit: boolean }) {
  const t = useTranslations('trends');
  const router = useRouter();
  const [text, setText] = useState(keywords.join(', '));
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save() {
    setPending(true);
    setStatus(null);
    const words = [...new Set(text.split(',').map((word) => word.trim()).filter(Boolean))];
    const response = await fetch('/api/workspace', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trendKeywords: words }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setStatus({ kind: 'error', text: body?.error ?? t('saveFailed') });
      return;
    }
    setStatus({ kind: 'ok', text: t('saved') });
    router.refresh();
  }

  return (
    <section aria-labelledby="trend-keywords" className="card p-5">
      <h2 id="trend-keywords" className="text-sm font-semibold text-slate-900">
        {t('keywords')}
      </h2>
      {canEdit ? (
        <>
          <label htmlFor="trend-keywords-input" className="mt-1 block text-xs text-slate-500">
            {t('keywordsHint')}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="trend-keywords-input"
              className="input min-w-0 flex-1"
              value={text}
              maxLength={1000}
              placeholder={t('keywordsPlaceholder')}
              onChange={(event) => setText(event.target.value)}
            />
            <button type="button" className="btn-primary" onClick={save} disabled={pending}>
              {t('saveKeywords')}
            </button>
          </div>
          {status && (
            <p role="status" className={`mt-2 text-xs ${status.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
              {status.text}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-600">{keywords.length ? keywords.join(', ') : t('keywordsNone')}</p>
      )}
    </section>
  );
}
