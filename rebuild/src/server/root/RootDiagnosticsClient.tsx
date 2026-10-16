'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { formatRootTimestamp } from '@/lib/root-time';
import { diagnosticConfirmation, diagnosticRunSchema, type DiagnosticReceipt } from '@/lib/diagnostics';
import type { listRootDiagnostics } from './diagnostics';

type Snapshot = Awaited<ReturnType<typeof listRootDiagnostics>>;
export function RootDiagnosticsClient({ initial }: { initial: Snapshot }) {
  const router = useRouter();
  const formId = useId();
  const lock = useRef(false);
  const [connectionId, setConnectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<DiagnosticReceipt | null>(null);
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
      if (!response.ok) { setError(typeof body.error === 'string' ? body.error : 'Run could not be confirmed. Check history before retrying.'); return; }
      const parsed = diagnosticRunSchema.safeParse({ id: body.id, scope: body.scope, connectionId: body.connectionId, startedAt: body.startedAt, finishedAt: body.finishedAt, checks: body.checks });
      if (!parsed.success || parsed.data.scope !== initial.scope || parsed.data.connectionId !== (connectionId || null) || typeof body.auditRecorded !== 'boolean') throw new Error('Invalid receipt');
      setReceipt({ ...parsed.data, auditRecorded: body.auditRecorded, ...(body.auditRecorded ? {} : { warning: 'Completion audit could not be recorded. Keep these results and inspect history before repeating.' }) });
      router.refresh();
    } catch { setError('Run outcome is unconfirmed. Check diagnostic history before trying again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const latest = receipt ?? initial.history.find(item => item.result)?.result ?? null;
  return <section className="root-jobs" aria-label={`${initial.label} diagnostics`} aria-busy={busy}>
    <form id={formId} method="post" noValidate onSubmit={event => { event.preventDefault(); void run(); }} />
    <SidebarDock><section className="root-diagnostics__tools" aria-label="Diagnostic controls"><h2>Diagnostics</h2>
      {initial.scope.startsWith('platform:') && <label className="ui-field">Test connection<select className="ui-input" value={connectionId} disabled={busy} onChange={event => { setConnectionId(event.target.value); setReceipt(null); }}>
        <option value="">Configuration only</option>{initial.connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.workspaceId}</option>)}
      </select></label>}
      {initial.connections.length >= initial.connectionLimit && <p>Showing {initial.connectionLimit} recent connections. HTTP/MCP can test another exact connection ID.</p>}
      <Button type="submit" form={formId} variant="primary" disabled={busy || !initial.enabled}>{busy ? 'Testing…' : 'Run diagnostics'}</Button>
      <p>Wait at least {initial.minimumIntervalSeconds}s between runs. Unconfirmed runs can block retries for {initial.incompleteRunStaleSeconds}s.</p>
    </section></SidebarDock>
    <p className="root-jobs__eyebrow">Module health</p><h2>Diagnostics</h2>
    <p>Run checks from the sidebar. Provider checks read the selected connection; they do not publish, change ads or send messages. Passes prove only the stated checks.</p>
    {!initial.enabled && <p role="status">Diagnostics are disabled in Shared configuration.</p>}
    <div ref={feedback} tabIndex={-1} className="root-diagnostics__feedback">
      {error && <p role="alert">{error}</p>}{receipt && <p role="status">Checks finished: {receipt.checks.filter(check => check.status === 'pass').length} passed, {receipt.checks.filter(check => check.status === 'fail').length} failed, {receipt.checks.filter(check => check.status === 'skipped').length} skipped.</p>}
      {receipt?.warning && <p role="alert">{receipt.warning}</p>}
    </div>
    {latest ? <><h3>Latest results</h3><p>{formatRootTimestamp(latest.finishedAt, initial.timeZone)} · {latest.connectionId ? `Connection ${latest.connectionId}` : 'No connection selected'}</p><ul className="root-jobs__latest">{latest.checks.map(check => <li key={check.id}>
      <strong>{check.label}</strong><span><b>{check.status === 'pass' ? 'Pass' : check.status === 'fail' ? 'Fail' : 'Skipped'}</b> · {check.durationMs}ms</span><span>{check.message}</span><small>{check.code}</small>
    </li>)}</ul></> : <p>No completed diagnostic results yet.</p>}
    <h3>Recent runs</h3>{initial.history.length ? <ul className="root-diagnostics__history">{initial.history.map(item => <li key={item.id}><time dateTime={item.startedAt}>{formatRootTimestamp(item.startedAt, initial.timeZone)}</time> · {item.result ? `${item.result.checks.filter(check => check.status === 'fail').length} failed, ${item.result.checks.filter(check => check.status === 'skipped').length} skipped` : 'Started; completion unconfirmed'}<small>{item.id}</small>{item.result && <details><summary>View results</summary><ul>{item.result.checks.map(check => <li key={check.id}><strong>{check.label}: {check.status}</strong> · {check.durationMs}ms<p>{check.message}</p></li>)}</ul></details>}</li>)}</ul> : <p>No runs recorded for this scope.</p>}
    <p><Link href="/root/activity?q=diagnostics">View diagnostic audit activity</Link></p>
  </section>;
}
