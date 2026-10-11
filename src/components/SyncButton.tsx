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
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as {
        error?: string;
        results?: Array<Record<string, unknown> & { errors?: Array<{ edge: string; message: string }> }>;
      };
      if (!response.ok) throw new Error(payload.error ?? tCommon('genericError'));
      // Say what came back: a pull that changes nothing on screen otherwise
      // reads as a button that does nothing.
      const results = payload.results ?? [];
      const refused = results.flatMap((row) => row.errors ?? [])[0];
      const fetched = results.reduce(
        (sum, row) =>
          sum + Object.values(row).reduce<number>((inner, value) => inner + (typeof value === 'number' ? value : 0), 0),
        0,
      );
      if (refused) setError(tCommon('syncRefused', { message: refused.message }));
      else if (payload.results) setNote(fetched > 0 ? tCommon('syncFetched', { count: fetched }) : tCommon('syncNothingNew'));
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
      {error && <span role="alert" className="max-w-xs text-right text-xs text-rose-600">{error}</span>}
      {note && <span role="status" className="text-xs text-slate-500">{note}</span>}
    </span>
  );
}
