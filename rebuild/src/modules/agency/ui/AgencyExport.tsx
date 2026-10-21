'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { agencyExportCopy, type AgencyExportCatalog, type AgencyExportLocale } from '../export-copy';

/** Remount on filter changes so an old request can never download a new filter's export. */
export function AgencyExport({ query, locale, catalog = agencyExportCopy }: { query: string; locale: AgencyExportLocale; catalog?: AgencyExportCatalog }) {
  const toast = useToast();
  const t = catalog[locale];
  const request = useRef<AbortController | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<'prepared' | 'failed' | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback]);
  async function download(format: 'csv' | 'json') {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setFeedback(null);
    try {
      const params = new URLSearchParams(query); params.set('format', format); params.set('locale', locale);
      const response = await fetch(`/api/agency?${params}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('refused');
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (result.ok !== true || result.version !== 1 || result.format !== format || result.filename !== `agency-overview.${format}` || typeof result.contents !== 'string'
        || result.contentType !== (format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8')
        || new TextEncoder().encode(result.contents).length !== result.bytes) throw new Error('unconfirmed');
      const url = URL.createObjectURL(new Blob([result.contents], { type: result.contentType }));
      try {
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename;
        document.body.append(anchor); anchor.click(); anchor.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 0); }
      setFeedback('prepared'); toast.notify({ title: t.prepared });
    } catch { if (!controller.signal.aborted) { setFeedback('failed'); toast.failed(t.failed, () => void download(format), format === 'csv' ? t.csv : t.json); } }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  return <section aria-label={t.title}>
    <p className="small-note">{t.help}</p>
    <Button disabled={busy} onClick={() => download('csv')}>{busy ? t.pending : t.csv}</Button>{' '}
    <Button disabled={busy} onClick={() => download('json')}>{busy ? t.pending : t.json}</Button>
    {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback === 'failed' ? 'alert' : 'status'} className={feedback === 'failed' ? 'ui-error' : 'small-note'}>{t[feedback]}</p>}
  </section>;
}
