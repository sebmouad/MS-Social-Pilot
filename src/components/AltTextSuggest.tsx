'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** "Suggest" under a photo's alt text box (H5): the AI describes the picture; the text stays editable. */
export default function AltTextSuggest({
  mediaId,
  number,
  context,
  targetIds,
  onSuggest,
}: {
  mediaId: string;
  number: number;
  context: string;
  targetIds: string[];
  onSuggest: (text: string) => void;
}) {
  const t = useTranslations('altText');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'altText', mediaId, context, targetIds }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { text?: string; error?: string } | undefined;
    setPending(false);
    if (!response?.ok || !body?.text) {
      setError(body?.error ?? t('failed'));
      return;
    }
    onSuggest(body.text);
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-60"
        aria-label={t('suggestFor', { number })}
        disabled={pending}
        onClick={suggest}
      >
        {pending ? t('suggesting') : t('suggest')}
      </button>
      {error && (
        <p role="alert" className="mt-0.5 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
