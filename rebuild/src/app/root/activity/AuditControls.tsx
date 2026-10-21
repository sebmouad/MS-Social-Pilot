'use client';
import { ROOT_AUDIT_BOUNDS, ROOT_AUDIT_CONTROLS_COPY, ROOT_AUDIT_DOWNLOAD, auditControlsText, type RootAuditControlsCopy, type RootAuditDownloadPolicy } from '@/lib/config/root-audit-controls';
import { Button } from '@/components/Button';
import { useActionState, useRef, useState, type ChangeEvent } from 'react';

export function AuditExport({ href, limit, copy = ROOT_AUDIT_CONTROLS_COPY, downloadPolicy = ROOT_AUDIT_DOWNLOAD }: { href: string; limit: number; copy?: RootAuditControlsCopy; downloadPolicy?: RootAuditDownloadPolicy }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  async function download() {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage('');
    try {
      const response = await fetch(href, { cache: 'no-store' });
      // Server text is never shown: any refused or failed export maps to the catalog sentence.
      if (!response.ok) throw new Error(copy.exportFailure);
      if (!response.headers.get('content-type')?.startsWith('text/csv')) throw new Error(copy.invalidResponse);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = downloadPolicy.filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), downloadPolicy.objectUrlReleaseMs);
      setMessage(copy.prepared);
    } catch (error) { setMessage(error instanceof Error ? error.message : copy.exportFailure); }
    finally { busy.current = false; setPending(false); }
  }
  return <div><Button type="button" disabled={pending} onClick={download}>{pending ? copy.preparing : copy.export}</Button><p>{auditControlsText(copy.coverage, { limit })}</p><p role="status">{message}</p></div>;
}
export function AuditRetention({ days, exportRows, batchSize, save, copy = ROOT_AUDIT_CONTROLS_COPY }: { days: number; exportRows: number; batchSize: number; copy?: RootAuditControlsCopy; save: (previous: string, data: FormData) => Promise<string> }) {
  // Controlled values: React resets an uncontrolled form after its action, which would discard typed input when saving fails.
  const [values, setValues] = useState({ days: String(days), exportRows: String(exportRows), batchSize: String(batchSize) });
  const [message, action, pending] = useActionState(async (previous: string, data: FormData) => {
    // A failed request (expired session, server error) keeps the page and the typed values instead of reaching the error boundary.
    try { return await save(previous, data); } catch { return copy.saveFailure; }
  }, '');
  const change = (name: keyof typeof values) => (event: ChangeEvent<HTMLInputElement>) => setValues(current => ({ ...current, [name]: event.currentTarget.value }));
  return <form action={action}><label>{copy.retention} <input name="days" type="number" min={ROOT_AUDIT_BOUNDS.retentionDays.min} max={ROOT_AUDIT_BOUNDS.retentionDays.max} required value={values.days} onChange={change('days')} /></label><label>{copy.exportRows} <input name="exportRows" type="number" min={ROOT_AUDIT_BOUNDS.exportRows.min} max={ROOT_AUDIT_BOUNDS.exportRows.max} required value={values.exportRows} onChange={change('exportRows')} /></label><label>{copy.batchSize} <input name="batchSize" type="number" min={ROOT_AUDIT_BOUNDS.batchSize.min} max={ROOT_AUDIT_BOUNDS.batchSize.max} required value={values.batchSize} onChange={change('batchSize')} /></label><p>{copy.warning}</p><Button type="submit" disabled={pending}>{pending ? copy.saving : copy.save}</Button><p role="status">{message}</p></form>;
}
