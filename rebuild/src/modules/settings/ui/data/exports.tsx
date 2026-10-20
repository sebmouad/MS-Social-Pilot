'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { DataTable } from '@/components/DataTable';
import { exportCopy } from './export-copy';

type ExportStatus = 'requested' | 'running' | 'ready' | 'failed' | 'expired';
type ExportJob = { id: string; status: ExportStatus; createdAt: string; expiresAt: string | null };
const statuses = new Set(['requested', 'running', 'ready', 'failed', 'expired']);
function isJob(value: unknown): value is ExportJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as ExportJob;
  return typeof job.id === 'string' && statuses.has(job.status) && typeof job.createdAt === 'string'
    && Number.isFinite(Date.parse(job.createdAt)) && (job.expiresAt === null || (typeof job.expiresAt === 'string' && Number.isFinite(Date.parse(job.expiresAt))));
}

export function WorkspaceExports({ workspaceId, locale = 'en' }: { workspaceId: string; locale?: 'en' | 'fr' }) {
  const copy = exportCopy[locale];
  const [jobs, setJobs] = useState<ExportJob[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'requested' | 'failure' | null>(null);
  const busyRef = useRef(false);
  const expected = `REQUEST WORKSPACE EXPORT ${workspaceId}`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/settings/data/exports', { cache: 'no-store', signal });
      const result: unknown = await response.json();
      const rows = (result as { jobs?: unknown })?.jobs;
      if (!response.ok || !Array.isArray(rows) || !rows.every(isJob)) throw new Error();
      if (!signal?.aborted) { setJobs(rows); setLoadError(false); }
    } catch { if (!signal?.aborted) setLoadError(true); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => { void refresh(controller.signal); }, 10000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh, workspaceId]);
  async function requestExport() {
    if (busyRef.current || confirmation !== expected) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch('/api/settings/data/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
      const result: unknown = await response.json();
      if (!response.ok || !isJob((result as { job?: unknown })?.job)) throw new Error();
      setNotice('requested'); setOpen(false); setConfirmation('');
      await refresh();
    } catch { setNotice('failure'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <div>
    <Button variant="primary" onClick={() => { setOpen(true); setNotice(null); }}>{copy.request}</Button>{' '}
    <Button onClick={() => { void refresh(); }}>{copy.refresh}</Button>
    {notice && !open && <p role={notice === 'failure' ? 'alert' : 'status'} tabIndex={-1} ref={node => node?.focus()}>{copy[notice]}</p>}
    {loadError ? <p role="alert">{copy.loadError}</p> : jobs === null ? <p role="status">{copy.loading}</p> : <DataTable caption={copy.history} rows={jobs} rowKey={job => job.id} emptyMessage={copy.empty} columns={[
      { key: 'created', label: copy.created, render: job => date(job.createdAt) },
      { key: 'status', label: copy.status, render: job => <>{copy.statuses[job.status]}{job.status === 'failed' && <p>{copy.failed}</p>}</> },
      { key: 'expiry', label: copy.expiry, render: job => job.expiresAt ? date(job.expiresAt) : copy.preparing },
      { key: 'download', label: copy.download, render: job => job.status === 'ready' && job.expiresAt && Date.parse(job.expiresAt) > Date.now() ? <a className="ui-button ui-button--secondary ui-button--sm" href={`/api/settings/data/exports/${encodeURIComponent(job.id)}`}>{copy.download}</a> : copy.unavailable },
    ]} />}
    <Dialog open={open} title={copy.title} description={copy.description} busy={busy} onClose={() => { if (!busy) setOpen(false); }} actions={<><Button disabled={busy} onClick={() => setOpen(false)}>{copy.cancel}</Button><Button variant="primary" disabled={busy || confirmation !== expected} onClick={requestExport}>{busy ? copy.pending : copy.request}</Button></>}>
      <p>{copy.confirmation}</p><p style={{ overflowWrap: 'anywhere' }}><code>{expected}</code></p>
      <label htmlFor="workspace-export-confirmation">{copy.confirmation}</label>
      <input id="workspace-export-confirmation" className="ui-input" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
      {notice === 'failure' && <p role="alert" tabIndex={-1} ref={node => node?.focus()}>{copy.failure}</p>}
    </Dialog>
  </div>;
}
