'use client';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog, useToast } from '@/components';
import { DataTable } from '@/components/DataTable';


type ExportStatus = 'requested' | 'running' | 'ready' | 'failed' | 'expired';
type ExportJob = { id: string; status: ExportStatus; createdAt: string; expiresAt: string | null };
const statuses = new Set(['requested', 'running', 'ready', 'failed', 'expired']);
function isJob(value: unknown): value is ExportJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as ExportJob;
  return typeof job.id === 'string' && statuses.has(job.status) && typeof job.createdAt === 'string'
    && Number.isFinite(Date.parse(job.createdAt)) && (job.expiresAt === null || (typeof job.expiresAt === 'string' && Number.isFinite(Date.parse(job.expiresAt))));
}

export function WorkspaceExports({ workspaceId, workspaceName = workspaceId, locale = 'en' }: { workspaceId: string; workspaceName?: string; locale?: 'en' | 'fr' }) {
  const toast = useToast();
  const copy = useSettingsCopy('exports', locale);
  const [jobs, setJobs] = useState<ExportJob[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
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
    if (busyRef.current) return copy.failure;
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch('/api/settings/data/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: expected }) });
      const result: unknown = await response.json();
      if (!response.ok || !isJob((result as { job?: unknown })?.job)) throw new Error();
      setNotice('requested'); setOpen(false); toast.notify({ title: copy.requested });
      await refresh();
    } catch { setNotice('failure'); toast.failed(copy.failure, () => void refresh(), copy.refresh); return copy.failure; }
    finally { busyRef.current = false; setBusy(false); }
  }
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <div>
    <Button variant="primary" onClick={() => { setOpen(true); setNotice(null); }}>{copy.request}</Button>{' '}
    <Button onClick={() => { void refresh(); }}>{copy.refresh}</Button>
    {notice && !open && <p role={notice === 'failure' ? 'alert' : 'status'} tabIndex={-1} ref={node => node?.focus()}>{copy[notice]}</p>}
    {loadError ? <p role="alert">{copy.loadError}</p> : jobs === null ? <p role="status">{copy.loading}</p> : <DataTable caption={copy.history} rows={jobs} rowKey={job => job.id} emptyMessage={copy.empty} emptyAction={<Button onClick={() => setOpen(true)}>{copy.request}</Button>} columns={[
      { key: 'created', label: copy.created, render: job => date(job.createdAt) },
      { key: 'status', label: copy.status, render: job => <>{copy.statuses[job.status]}{job.status === 'failed' && <p>{copy.failed}</p>}</> },
      { key: 'expiry', label: copy.expiry, render: job => job.expiresAt ? date(job.expiresAt) : copy.preparing },
      { key: 'download', label: copy.download, render: job => job.status === 'ready' && job.expiresAt && Date.parse(job.expiresAt) > Date.now() ? <a className="ui-button ui-button--secondary ui-button--sm" href={`/api/settings/data/exports/${encodeURIComponent(job.id)}`}>{copy.download}</a> : copy.unavailable },
    ]} />}
    {open && <ConfirmDialog open title={copy.title} objectName={workspaceName} consequence={copy.description} confirmLabel={copy.request} cancelLabel={copy.cancel} pendingLabel={copy.pending} failureLabel={copy.failure} danger={false} onClose={() => setOpen(false)} onConfirm={async () => (await requestExport()) ?? null} />}

  </div>;
}
