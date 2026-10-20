'use client';
import { ROOT_AUDIT_BOUNDS, ROOT_AUDIT_CONTROLS_COPY, ROOT_AUDIT_DOWNLOAD, auditControlsText, type RootAuditControlsCopy, type RootAuditDownloadPolicy } from '@/lib/config/root-audit-controls';
import { Button } from '@/components/Button';
import { useActionState, useRef, useState } from 'react';

export function AuditExport({ href, limit, copy = ROOT_AUDIT_CONTROLS_COPY, downloadPolicy = ROOT_AUDIT_DOWNLOAD }: { href: string; limit: number; copy?: RootAuditControlsCopy; downloadPolicy?: RootAuditDownloadPolicy }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  async function download() {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage('');
    try {
      const response = await fetch(href, { cache: 'no-store' });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(typeof result.error === 'string' ? result.error : copy.exportFailure);
      }
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
  const [message, action, pending] = useActionState(save, '');
  return <form action={action}><label>{copy.retention} <input name="days" type="number" min={ROOT_AUDIT_BOUNDS.retentionDays.min} max={ROOT_AUDIT_BOUNDS.retentionDays.max} required defaultValue={days} /></label><label>{copy.exportRows} <input name="exportRows" type="number" min={ROOT_AUDIT_BOUNDS.exportRows.min} max={ROOT_AUDIT_BOUNDS.exportRows.max} required defaultValue={exportRows} /></label><label>{copy.batchSize} <input name="batchSize" type="number" min={ROOT_AUDIT_BOUNDS.batchSize.min} max={ROOT_AUDIT_BOUNDS.batchSize.max} required defaultValue={batchSize} /></label><p>{copy.warning}</p><Button type="submit" disabled={pending}>{pending ? copy.saving : copy.save}</Button><p role="status">{message}</p></form>;
}
