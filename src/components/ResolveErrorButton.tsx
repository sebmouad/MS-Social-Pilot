'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** Root's "Mark resolved" on one error kind. */
export function ResolveErrorButton({ id }: { id: string }) {
  const t = useTranslations('root.errors');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary px-3 py-1 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          const response = await fetch(`/api/root/errors/${id}`, { method: 'POST' }).catch(() => null);
          setBusy(false);
          if (response?.ok) router.refresh();
          else setFailed(true);
        }}
      >
        {t('resolve')}
      </button>
      {failed && (
        <span role="alert" className="text-xs text-red-700">
          {t('resolveFailed')}
        </span>
      )}
    </span>
  );
}
