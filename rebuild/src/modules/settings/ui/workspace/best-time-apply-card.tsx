'use client';
import { useCallback, useEffect, useState } from 'react';
import { IconClock } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { ConfirmDialog, useToast } from '@/components';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';
import type { BestTimeApplyStatus } from '@/modules/publishing/server/best-time-apply';

const fill = (template: string, ...values: Array<string | number>) => values.reduce<string>((text, value, index) => text.replace(`{${index}}`, String(value)), template);
type StatusView = BestTimeApplyStatus & { labels?: { lastRunAt?: string; nextEligibleAt?: string } };
const isStatus = (value: unknown): value is StatusView => !!value && typeof value === 'object' && 'mode' in (value as object);

export function BestTimeApplyCard({ locale }: { locale: 'en' | 'fr' }) {
  const toast = useToast();
  const t = useSettingsCopy('operations', locale);
  const cancel = useSettingsCopy('team', locale).cancel;
  const [status, setStatus] = useState<StatusView | null>(null);
  const [open, setOpen] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/publishing/best-times/apply', { cache: 'no-store', signal });
      const result: unknown = await response.json();
      if (response.ok && isStatus(result) && !signal?.aborted) setStatus(result);
    } catch { /* managers-only; the mode switch above stays the source of truth */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  const applyNow = async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/publishing/best-times/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'APPLY BEST TIMES' }) });
      const result = (await response.json()) as { channels?: number; added?: number };
      if (!response.ok || typeof result.added !== 'number' || typeof result.channels !== 'number') return t.bestTimeApplyFailed;
      setOpen(false);
      toast.notify({ title: fill(t.bestTimeApplied, result.added, result.channels) });
      await refresh();
      return null;
    } catch { return t.bestTimeApplyFailed; }
  };
  if (!status) return null;
  return <div>
    <p><IconClock aria-hidden="true" /> <strong>{t.bestTimeAuto}</strong></p>
    <p>{status.mode === 'apply' ? t.bestTimeAutoOn : t.bestTimeAutoOff}</p>
    <p>{status.lastRunAt ? fill(t.bestTimeLastRun, status.labels?.lastRunAt ?? '') : t.bestTimeNeverRun}{status.mode === 'apply' && status.nextEligibleAt ? ` · ${fill(t.bestTimeNextRun, status.labels?.nextEligibleAt ?? '')}` : ''}</p>
    {status.mode === 'apply' ? <Button variant="secondary" onClick={() => setOpen(true)}>{t.bestTimeApplyNow}</Button> : null}
    {open && <ConfirmDialog open title={t.bestTimeAuto} objectName={t.bestTimeAuto} consequence={t.bestTimeApplyReview} confirmLabel={t.bestTimeApplyNow} cancelLabel={cancel} pendingLabel={t.saving} failureLabel={t.bestTimeApplyFailed} danger={false} onClose={() => setOpen(false)} onConfirm={applyNow} />}
  </div>;
}
