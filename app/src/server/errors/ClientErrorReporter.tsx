'use client';
import { useEffect } from 'react';

/** Reports an error that a React error boundary caught (window listeners never see those). Best effort. */
export function reportBoundaryError(error: { name?: string; message?: string; stack?: string }) {
  void fetch('/api/errors', {
    method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: error.name ?? 'Error', message: error.message || 'Unknown error', ...(error.stack ? { stack: error.stack } : {}), path: window.location.pathname }),
  }).catch(() => undefined);
}

/**
 * Sends uncaught browser errors to the app's own recorder (`/api/errors`). Only the page path is sent, never the
 * query string. The server decides whether recording is on; `maxReports` (a Root setting) stops a failing loop.
 */
export function ClientErrorReporter({ maxReports }: { maxReports: number }) {
  useEffect(() => {
    let sent = 0;
    const send = (name: string, message: string, stack?: string) => {
      if (sent >= maxReports) return;
      sent += 1;
      void fetch('/api/errors', {
        method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, message, ...(stack ? { stack } : {}), path: window.location.pathname }),
      }).catch(() => undefined);
    };
    const onError = (event: ErrorEvent) => send(event.error?.name ?? 'Error', event.message || 'Unknown error', event.error?.stack);
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      send(reason?.name ?? 'UnhandledRejection', typeof reason === 'string' ? reason : reason?.message ?? 'Unhandled promise rejection', reason?.stack);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, [maxReports]);
  return null;
}
