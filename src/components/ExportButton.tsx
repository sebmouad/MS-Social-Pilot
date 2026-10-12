'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** Ask the worker for a new export; the list below shows it once queued. */
export function ExportButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations('workspaceExport');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-primary"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          const response = await fetch('/api/exports', { method: 'POST' }).catch(() => null);
          setBusy(false);
          if (response?.ok) router.refresh();
          else setFailed(true);
        }}
      >
        {busy ? t('requesting') : t('request')}
      </button>
      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {t('requestFailed')}
        </p>
      )}
    </div>
  );
}
