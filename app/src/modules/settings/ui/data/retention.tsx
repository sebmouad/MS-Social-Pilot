'use client';
import { useCallback, useEffect, useState } from 'react';
import { IconHistory, IconSparkles } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { ConfirmDialog, useToast } from '@/components';
import styles from '../settings.module.css';
import type { RetentionCopy } from '@/modules/settings/retention-copy';
import type { RetentionPolicy, RetentionCounts } from '@/modules/settings/server/retention';

type Status = { policy: RetentionPolicy; pending: RetentionCounts; lastRun: { startedAt: string; summary: string | null; outcome: string } | null };
const isStatus = (value: unknown): value is Status => !!value && typeof value === 'object' && 'policy' in (value as object) && 'pending' in (value as object);
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));

export function RetentionPanel({ copy: t, locale }: { copy: RetentionCopy; locale: 'en' | 'fr' }) {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/settings/data/retention', { cache: 'no-store', signal });
      const result: unknown = await response.json();
      if (!response.ok || !isStatus(result)) throw new Error();
      if (!signal?.aborted) { setStatus(result); setFailed(false); }
    } catch { if (!signal?.aborted) setFailed(true); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  const runNow = async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/settings/data/retention', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'PRUNE OLD RECORDS' }) });
      const result: unknown = await response.json();
      if (!response.ok || typeof (result as { total?: unknown })?.total !== 'number') throw new Error();
      setOpen(false);
      toast.notify({ title: t.ran });
      await refresh();
      return null;
    } catch { return t.failed; }
  };
  if (failed) return <p role="alert">{t.failed}</p>;
  if (!status) return <p aria-busy="true">{t.working}</p>;
  const rows: Array<[string, number, number]> = [
    [t.activity, status.pending.activity, status.policy.auditDays],
    [t.emails, status.pending.emails, status.policy.emailDays],
    [t.clicks, status.pending.clicks, status.policy.clickDays],
    [t.ai, status.pending.ai, status.policy.aiDays],
    [t.reports, status.pending.reports, status.policy.analyticsDays],
  ];
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  return <div className={styles['retention-panel']}>
    <dl className={styles['retention-list']}>
      {rows.map(([label, count, days]) => <div key={label}>
        <dt>{label} <small>{fill(t.olderThan, { days })}</small></dt>
        <dd>{count > 0 ? fill(t.pendingNow, { count }) : t.noneNow}</dd>
      </div>)}
    </dl>
    <p className={styles['settings-note']}>{status.lastRun
      ? <span><IconHistory aria-hidden="true" /> {fill(t.lastRun, { summary: status.lastRun.summary ?? status.lastRun.outcome })}</span>
      : <span><IconSparkles aria-hidden="true" /> {t.neverRun}</span>}</p>
    <Button variant="secondary" onClick={() => setOpen(true)} disabled={total === 0}>{t.runNow}</Button>
    {open && <ConfirmDialog open title={t.title} objectName={t.title} consequence={t.runReview} confirmLabel={t.runNow} cancelLabel={t.cancel} pendingLabel={t.working} failureLabel={t.failed} onClose={() => setOpen(false)} onConfirm={runNow} />}
  </div>;
}
