'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** Add a finished test's winning caption to the voice of its Pages. */
export function CaptionTestLearnButton({ id }: { id: string }) {
  const t = useTranslations('captionTests');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            const response = await fetch(`/api/caption-tests/${id}/learn`, { method: 'POST' });
            if (!response.ok) throw new Error();
            router.refresh();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('learn')}
      </button>
      {failed && (
        <span role="alert" className="text-xs text-red-700">
          {t('learnFailed')}
        </span>
      )}
    </span>
  );
}
