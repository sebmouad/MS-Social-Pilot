'use client';
import { useRootActionFeedback } from './RootActionFeedback';
import { Select } from '@/components/Select';
import { Badge } from '@/components/Badge';
import { IconHeartbeat } from '@tabler/icons-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { formatRootTimestamp } from '@/lib/root-time';
import { diagnosticConfirmation, diagnosticRunSchema, type DiagnosticReceipt } from '@/lib/diagnostics';
import type { listRootDiagnostics } from './diagnostics';
import { diagnosticsCopyText, type RootDiagnosticsCopy } from '@/lib/config/root-diagnostics-copy';

type Snapshot = Awaited<ReturnType<typeof listRootDiagnostics>>;
export function RootDiagnosticsClient({ initial, copy }: { initial: Snapshot; copy: RootDiagnosticsCopy }) {
  const router = useRouter();
  const formId = useId();
  const lock = useRef(false);
  const [connectionId, setConnectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<DiagnosticReceipt | null>(null);
  useRootActionFeedback(error, receipt ? diagnosticsCopyText(copy.checksFinished, { passed: receipt.checks.filter(check => check.status === 'pass').length, failed: receipt.checks.filter(check => check.status === 'fail').length, skipped: receipt.checks.filter(check => check.status === 'skipped').length }) : '', () => router.refresh(), receipt?.checks.some(check => check.status === 'fail') ? 'error' : 'success');
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!busy && (error || receipt)) { feedback.current?.focus(); feedback.current?.scrollIntoView?.({ block: 'nearest' }); }
  }, [busy, error, receipt]);
  async function run() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setReceipt(null);
    try {
      const response = await fetch('/api/root/diagnostics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: initial.scope, ...(connectionId ? { connectionId } : {}), confirmation: diagnosticConfirmation(initial.scope) }) });
      const body = await response.json();
      if (!response.ok) { setError(typeof body.error === 'string' ? body.error : copy.fallbackFailure); return; }
      const parsed = diagnosticRunSchema.safeParse({ id: body.id, scope: body.scope, connectionId: body.connectionId, startedAt: body.startedAt, finishedAt: body.finishedAt, checks: body.checks });
      if (!parsed.success || parsed.data.scope !== initial.scope || parsed.data.connectionId !== (connectionId || null) || typeof body.auditRecorded !== 'boolean') throw new Error(copy.invalidReceipt);
      setReceipt({ ...parsed.data, auditRecorded: body.auditRecorded, ...(body.auditRecorded ? {} : { warning: copy.auditWarning }) });
      router.refresh();
    } catch { setError(copy.outcomeUnconfirmed); }
    finally { lock.current = false; setBusy(false); }
  }
  const latest = receipt ?? initial.history.find(item => item.result)?.result ?? null;
  return <section className="root-jobs" aria-label={diagnosticsCopyText(copy.sectionLabel, { label: initial.label })} aria-busy={busy}>
    <form id={formId} method="post" noValidate onSubmit={event => { event.preventDefault(); void run(); }} />
    <SidebarDock><section className="root-diagnostics__tools" aria-label={copy.controls}><h2>{copy.title}</h2>
      {initial.scope.startsWith('platform:') && <Select aria-label={copy.testConnection} searchable searchLabel={copy.testConnection} placeholder={copy.configurationOnly} options={[{ value: '', label: copy.configurationOnly }, ...initial.connections.map(connection => ({ value: connection.id, label: `${connection.name} · ${connection.workspaceId}` }))]} value={connectionId} disabled={busy} onChange={value => { setConnectionId(value); setReceipt(null); }} />}
      {initial.connections.length >= initial.connectionLimit && <p>{diagnosticsCopyText(copy.connectionLimit, { limit: initial.connectionLimit })}</p>}
      <Button leading={<IconHeartbeat size={18} />} type="submit" form={formId} variant="primary" disabled={busy || !initial.enabled}>{busy ? copy.testing : copy.run}</Button>
      <p>{diagnosticsCopyText(copy.wait, { interval: initial.minimumIntervalSeconds, stale: initial.incompleteRunStaleSeconds })}</p>
    </section></SidebarDock>
    <p className="root-jobs__eyebrow">{copy.moduleHealth}</p><h2>{copy.title}</h2>
    <p>{copy.explanation}</p>
    {!initial.enabled && <p role="status">{copy.disabled}</p>}
    <div ref={feedback} tabIndex={-1} className="root-diagnostics__feedback">
      {error && <p role="alert">{error}</p>}{receipt && <p role="status">{diagnosticsCopyText(copy.checksFinished, { passed: receipt.checks.filter(check => check.status === 'pass').length, failed: receipt.checks.filter(check => check.status === 'fail').length, skipped: receipt.checks.filter(check => check.status === 'skipped').length })}</p>}
      {receipt?.warning && <p role="alert">{receipt.warning}</p>}
    </div>
    {latest ? <><h3>{copy.latestResults}</h3><p>{formatRootTimestamp(latest.finishedAt, initial.timeZone)} · {latest.connectionId ? diagnosticsCopyText(copy.connection, { id: latest.connectionId }) : copy.noConnection}</p><ul className="root-jobs__latest">{latest.checks.map(check => <li key={check.id}>
      <strong>{check.label}</strong><span><Badge tone={check.status === 'pass' ? 'success' : check.status === 'fail' ? 'danger' : 'neutral'}>{check.status === 'pass' ? copy.pass : check.status === 'fail' ? copy.fail : copy.skipped}</Badge> · {check.durationMs}ms</span><span>{check.message}</span><small>{check.code}</small>
    </li>)}</ul></> : <p>{copy.noResults}</p>}
    <h3>{copy.recentRuns}</h3>{initial.history.length ? <ul className="root-diagnostics__history">{initial.history.map(item => <li key={item.id}><time dateTime={item.startedAt}>{formatRootTimestamp(item.startedAt, initial.timeZone)}</time> · {item.result ? diagnosticsCopyText(copy.historyResult, { failed: item.result.checks.filter(check => check.status === 'fail').length, skipped: item.result.checks.filter(check => check.status === 'skipped').length }) : copy.startedUnconfirmed}<small>{item.id}</small>{item.result && <details><summary>{copy.viewResults}</summary><ul>{item.result.checks.map(check => <li key={check.id}><strong>{check.label}: {check.status === 'pass' ? copy.pass : check.status === 'fail' ? copy.fail : copy.skipped}</strong> · {check.durationMs}ms<p>{check.message}</p></li>)}</ul></details>}</li>)}</ul> : <p>{copy.noRuns}</p>}
    <p><Link href="/root/activity?q=diagnostics">{copy.auditActivity}</Link></p>
  </section>;
}
