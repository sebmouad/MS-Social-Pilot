'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * A POST-then-refresh button.
 *
 * The Instagram and Ads panels both need "discover" and "pull fresh data"
 * actions with identical behaviour, and the only thing that differs is the
 * endpoint and the body — so it is one component rather than two nearly
 * identical ones.
 */
export function SyncButton({
  endpoint,
  body,
  label,
  variant = 'secondary',
}: {
  endpoint: string;
  body?: Record<string, unknown>;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? tCommon('genericError'));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'}
        onClick={run}
        disabled={busy}
      >
        {busy ? tCommon('working') : label}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}
