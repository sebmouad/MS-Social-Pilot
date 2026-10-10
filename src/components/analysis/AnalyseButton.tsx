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

  /** How often to ask whether the read has finished, and for how long. */
  const POLL_MS = 3000;
  const GIVE_UP_MS = 6 * 60 * 1000;

  async function run() {
    setBusy(true);
    setStatus(null);
    try {
      // Starts the read and is answered straight away: the read itself can
      // take longer than the proxy waits, so the screen asks how it is going.
      const started = await fetch('/api/analytics/analysis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId, days }),
      });
      if (!started.ok) {
        const body = (await started.json().catch(() => ({}))) as { error?: string };
        setStatus({ kind: 'error', text: body.error ?? t('failed') });
        return;
      }

      const deadline = Date.now() + GIVE_UP_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const response = await fetch(
          `/api/analytics/analysis?status=1&targetId=${encodeURIComponent(targetId)}`,
        );
        const state = (await response.json().catch(() => ({}))) as
          | { state: 'running' | 'idle' }
          | { state: 'done'; result: { postsRefreshed?: number; problems?: string[] } }
          | { state: 'failed'; message: string };
        if (!response.ok || state.state === 'failed') {
          setStatus({ kind: 'error', text: t('failed') });
          return;
        }
        if (state.state === 'done') {
          const { problems = [], postsRefreshed = 0 } = state.result;
          setStatus(
            problems.length > 0
              ? { kind: 'warning', text: t('partial', { detail: problems.join(' · ') }) }
              : { kind: 'ok', text: t('analysed', { count: postsRefreshed }) },
          );
          router.refresh();
          return;
        }
        // 'idle' means the web process restarted mid-read: say so rather than wait.
        if (state.state === 'idle') {
          setStatus({ kind: 'error', text: t('failed') });
          return;
        }
      }
      setStatus({ kind: 'warning', text: t('stillReading') });
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
