'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Read this Page from Facebook now, then redraw the analysis.
 *
 * Says what happened in words rather than just stopping spinning: a refresh
 * that half-worked — an expired token on one edge — still redraws what it
 * could, and the person is told which part is missing.
 */
export function AnalyseButton({ targetId, days }: { targetId: string; days: number }) {
  const t = useTranslations('pageAnalysis');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'warning' | 'error'; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch('/api/analytics/analysis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId, days }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        postsRefreshed?: number;
        problems?: string[];
      };
      if (!response.ok) {
        setStatus({ kind: 'error', text: body.error ?? t('failed') });
        return;
      }
      setStatus(
        body.problems && body.problems.length > 0
          ? { kind: 'warning', text: t('partial', { detail: body.problems.join(' · ') }) }
          : { kind: 'ok', text: t('analysed', { count: body.postsRefreshed ?? 0 }) },
      );
      router.refresh();
    } catch {
      setStatus({ kind: 'error', text: t('failed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button type="button" className="btn-primary" onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? t('analysing') : t('analyseNow')}
      </button>
      {status && (
        <p
          role={status.kind === 'ok' ? 'status' : 'alert'}
          className={`max-w-sm text-xs sm:text-right ${
            status.kind === 'ok' ? 'text-emerald-700' : status.kind === 'warning' ? 'text-amber-700' : 'text-red-600'
          }`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
