'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import type { RootMonitoringCopy } from '../monitoring-config';
export function MonitoringAction({ copy, confirmation }: { copy: RootMonitoringCopy; confirmation: string }) {
  const router = useRouter();
  const [success, setSuccess] = useState(false);
  const [ask, dialog] = useConfirm({ title: copy.review, cancel: copy.cancel, confirm: copy.evaluate, danger: false });
  async function evaluate() {
    setSuccess(false);
    const confirmed = await ask(copy.consequence, { exactConfirmation: confirmation, confirmationLabel: copy.confirmation, pendingLabel: copy.pending, failureLabel: copy.failure, onConfirm: async () => {
      const response = await fetch('/api/root/monitoring', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object') return copy.failure;
      const receipt = payload as { opened?: unknown; resolved?: unknown; checks?: unknown; uptime?: { app?: unknown; worker?: unknown } };
      if (!Array.isArray(receipt.opened) || !Array.isArray(receipt.resolved) || !Array.isArray(receipt.checks) || typeof receipt.uptime?.app !== 'boolean' || typeof receipt.uptime.worker !== 'boolean') return copy.failure;
      return null;
    } });
    if (confirmed) { setSuccess(true); router.refresh(); }
  }
  return <><Button type="button" onClick={() => void evaluate()}>{copy.evaluate}</Button>{success ? <p role="status">{copy.success}</p> : null}{dialog}</>;
}
