'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';

type CsvExportCopy = {
  heading: string;
  help: string;
  action: string;
  pending: string;
  noun: { singular: string; plural: string };
};

type CsvExportButtonProps = {
  href: string;
  expectedFormat: string;
  rowCountHeader: string;
  maxRows: number;
  maxBytes: number;
  fileName: string;
  requireFileNameConfirmation?: boolean;
  copy: CsvExportCopy;
};

function safeOperationError(code: unknown, noun: CsvExportCopy['noun']) {
  if (code === 'unauthorized' || code === 'forbidden') return `You do not have permission to export these ${noun.plural}.`;
  if (code === 'invalid_request') return 'The export request was refused. Review the filters or narrow them to fit the configured export limit.';
  if (code === 'unavailable' || code === 'conflict' || code === 'reconnect_required') return 'The export is temporarily unavailable. Try again later or narrow the filters.';
  return 'The CSV could not be confirmed. Try again or narrow the filters.';
}

function validBoundedInteger(value: string | null, maximum: number, allowZero: boolean): number | null {
  if (!value || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= (allowZero ? 0 : 1) && parsed <= maximum ? parsed : null;
}

function validFileName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._ -]*\.csv$/.test(value);
}

function confirmedFileName(header: string | null): string | null {
  if (!header) return null;
  const match = /^attachment;\s*filename="([^"\r\n]+)"$/i.exec(header);
  return match && validFileName(match[1]) ? match[1] : null;
}

export function CsvExportButton({ href, expectedFormat, rowCountHeader, maxRows, maxBytes, fileName, requireFileNameConfirmation = false, copy }: CsvExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string; id: number } | null>(null);
  const activeRequest = useRef<{ controller: AbortController } | null>(null);
  const mounted = useRef(true);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const feedbackId = useRef(0);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
    };
  }, []);
  useLayoutEffect(() => () => {
    const request = activeRequest.current;
    if (request) {
      request.controller.abort();
      activeRequest.current = null;
      if (mounted.current) setBusy(false);
    }
    if (mounted.current) setFeedback(null);
  }, [href, fileName, expectedFormat, rowCountHeader, maxRows, maxBytes, requireFileNameConfirmation]);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback?.id]);

  function announce(kind: 'success' | 'error', text: string) {
    if (mounted.current) setFeedback({ kind, text, id: ++feedbackId.current });
  }

  async function download() {
    if (activeRequest.current) return;
    const request = { controller: new AbortController() };
    activeRequest.current = request;
    const isCurrent = () => mounted.current && activeRequest.current === request && !request.controller.signal.aborted;
    if (mounted.current) { setBusy(true); setFeedback(null); }
    try {
      const response = await fetch(href, { method: 'GET', cache: 'no-store', signal: request.controller.signal });
      if (!isCurrent()) return;
      if (!response.ok) {
        let code: unknown;
        try { code = (await response.json() as { code?: unknown }).code; } catch { /* Use safe generic feedback. */ }
        if (!isCurrent()) return;
        announce('error', safeOperationError(code, copy.noun));
        return;
      }

      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      const count = validBoundedInteger(response.headers.get(rowCountHeader), maxRows, true);
      const declaredBytes = validBoundedInteger(response.headers.get('x-msp-export-bytes'), maxBytes, false);
      const disposition = response.headers.get('content-disposition');
      const headerFileName = confirmedFileName(disposition);
      if (!validFileName(fileName) || contentType !== 'text/csv' || response.headers.get('x-msp-export-format') !== expectedFormat ||
        count === null || declaredBytes === null || (disposition !== null && (headerFileName === null || headerFileName !== fileName)) ||
        (requireFileNameConfirmation && headerFileName === null)) {
        throw new Error('unconfirmed');
      }
      const blob = await response.blob();
      if (!isCurrent()) return;
      if ((blob.type && !blob.type.toLowerCase().startsWith('text/csv')) || blob.size !== declaredBytes || blob.size > maxBytes) throw new Error('unconfirmed');

      const url = URL.createObjectURL(blob);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      if (!isCurrent()) return;
      announce('success', `Prepared CSV for ${count} ${count === 1 ? copy.noun.singular : copy.noun.plural}.`);
    } catch {
      if (isCurrent()) announce('error', 'The CSV could not be confirmed. Try again or narrow the filters.');
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  return <section aria-label={copy.heading}>
    <p className="small-note">{copy.help}</p>
    <Button onClick={download} disabled={busy}>{busy ? copy.pending : copy.action}</Button>
    {feedback ? <p ref={feedbackRef} tabIndex={-1} role={feedback.kind === 'error' ? 'alert' : 'status'} className={feedback.kind === 'error' ? 'ui-error' : 'small-note'}>{feedback.text}</p> : null}
  </section>;
}
