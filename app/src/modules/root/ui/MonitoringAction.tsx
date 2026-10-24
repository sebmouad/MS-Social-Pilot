'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBell, IconHeartbeat } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import type { RootMonitoringCopy } from '../monitoring-config';
export function MonitoringAction({ copy, confirmation, testConfirmation }: { copy: RootMonitoringCopy; confirmation: string; testConfirmation: string }) {
  const router = useRouter();
  const [action, setAction] = useState<'evaluate' | 'test' | null>(null);
  const [success, setSuccess] = useState('');
  const feedback = useRef<HTMLParagraphElement>(null);
  const [ask, dialog] = useConfirm({ title: action === 'test' ? copy.testReview : copy.review, cancel: copy.cancel, confirm: action === 'test' ? copy.test : copy.evaluate, danger: false });
  useEffect(() => { if (success) feedback.current?.focus(); }, [success]);
  async function evaluate() {
    if (action) return;
    setAction('evaluate');
    setSuccess('');
    const confirmed = await ask(copy.consequence, { exactConfirmation: confirmation, confirmationLabel: copy.confirmation, pendingLabel: copy.pending, failureLabel: copy.failure, onConfirm: async () => {
      const response = await fetch('/api/root/monitoring', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object') return copy.failure;
      const receipt = payload as { opened?: unknown; resolved?: unknown; checks?: unknown; uptime?: { app?: unknown; worker?: unknown } };
      if (!Array.isArray(receipt.opened) || !Array.isArray(receipt.resolved) || !Array.isArray(receipt.checks) || typeof receipt.uptime?.app !== 'boolean' || typeof receipt.uptime.worker !== 'boolean') return copy.failure;
      return null;
    } });
    setAction(null);
    if (confirmed) { setSuccess(copy.success); router.refresh(); }
  }
  async function test() {
    if (action) return;
    setAction('test');
    setSuccess('');
    const confirmed = await ask(copy.testConsequence, { exactConfirmation: testConfirmation, confirmationLabel: copy.confirmation, pendingLabel: copy.testPending, failureLabel: copy.testFailure, onConfirm: async () => {
      const response = await fetch('/api/root/monitoring/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: testConfirmation }) });
      const receipt: unknown = await response.json().catch(() => null);
      if (!response.ok || !receipt || typeof receipt !== 'object' || !('queued' in receipt) || receipt.queued !== true || !('id' in receipt) || typeof receipt.id !== 'string' || !receipt.id) return copy.testFailure;
      return null;
    } });
    setAction(null);
    if (confirmed) { setSuccess(copy.testSuccess); router.refresh(); }
  }
  return <><div className="ui-page-header__actions"><Button type="button" disabled={action !== null} leading={<IconHeartbeat size={18} />} onClick={() => void evaluate()}>{copy.evaluate}</Button><Button type="button" disabled={action !== null} leading={<IconBell size={18} />} onClick={() => void test()}>{copy.test}</Button></div>{success ? <p ref={feedback} tabIndex={-1} role="status">{success}</p> : null}{dialog}</>;
}
