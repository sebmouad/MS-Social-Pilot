'use client';
import { useAdsCatalogs } from '../AdsCopyProvider';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { RouteNotice } from '@/components/RouteNotice';
import { adsText, type AdsLocale } from '../../analysis/copy';

/** Keep filters and the report visible after a refused download. */
export function ComparisonExport({ href, locale, maxBytes }: { href: string; locale: AdsLocale; maxBytes: number }) {
  const { catalogs } = useAdsCatalogs();
  const text = (key: Parameters<typeof adsText>[1]) => adsText(locale, key, {}, catalogs.analysis);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => { current.current?.abort(); current.current = null; }, [href, maxBytes]);
  useEffect(() => { setBusy(false); setFeedback(null); }, [href, maxBytes]);

  async function download(kind: 'objects' | 'findings') {
    if (current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setBusy(true); setFeedback(null);
    try {
      const url = new URL(href, window.location.origin);
      url.searchParams.set('exportKind', kind);
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (controller.signal.aborted) return;
      const bytes = Number(response.headers.get('x-msp-export-bytes'));
      const name = /^attachment; filename="([A-Za-z0-9][A-Za-z0-9._ -]*\.csv)"$/.exec(response.headers.get('content-disposition') ?? '')?.[1];
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/csv;') ||
        response.headers.get('x-msp-export-format') !== 'ads-comparison-v1' || !name ||
        !Number.isSafeInteger(bytes) || bytes < 1 || bytes > maxBytes) throw new Error('unconfirmed');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (blob.size !== bytes) throw new Error('unconfirmed');
      const downloadUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = downloadUrl; anchor.download = name; anchor.hidden = true;
        document.body.append(anchor); anchor.click(); anchor.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0); }
      setFeedback('success');
    } catch {
      if (!controller.signal.aborted) setFeedback('error');
    } finally {
      if (current.current === controller) { current.current = null; setBusy(false); }
    }
  }
  return <div>
    <div className="ui-actions">
      <Button disabled={busy} onClick={() => void download('objects')}>{text(busy ? 'exportPending' : 'exportCsv')}</Button>
      <Button disabled={busy} onClick={() => void download('findings')}>{text('exportFindings')}</Button>
    </div>
    <p className="small-note">{text('exportHint')}</p>
    {feedback ? <RouteNotice error={feedback === 'error'} focusKey={feedback}>{text(feedback === 'error' ? 'exportError' : 'exportSuccess')}</RouteNotice> : null}
  </div>;
}
