'use client';
import { Button } from '@/components/Button';
import { useActionState, useRef, useState } from 'react';

export function AuditExport({ href, limit }: { href: string; limit: number }) {
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
        throw new Error(typeof result.error === 'string' ? result.error : 'Export failed. Please retry.');
      }
      if (!response.headers.get('content-type')?.startsWith('text/csv')) throw new Error('Export response was invalid. Please retry.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'root-activity.csv';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('CSV prepared.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed. Please retry.'); }
    finally { busy.current = false; setPending(false); }
  }
  return <div><Button type="button" disabled={pending} onClick={download}>{pending ? 'Preparing CSV…' : 'Export CSV'}</Button><p>All matching Root history, up to {limit} events. Oversized results are refused.</p><p role="status">{message}</p></div>;
}
export function AuditRetention({ days, exportRows, batchSize, save }: { days: number; exportRows: number; batchSize: number; save: (previous: string, data: FormData) => Promise<string> }) {
  const [message, action, pending] = useActionState(save, '');
  return <form action={action}><label>Audit retention days (0 keeps forever) <input name="days" type="number" min="0" max="36500" required defaultValue={days} /></label><label>Export row limit <input name="exportRows" type="number" min="1" max="100000" required defaultValue={exportRows} /></label><label>Retention batch size per table <input name="batchSize" type="number" min="1" max="10000" required defaultValue={batchSize} /></label><p>Applies to Root and workspace activity. Older events are permanently deleted in bounded worker batches.</p><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save audit settings'}</Button><p role="status">{message}</p></form>;
}
