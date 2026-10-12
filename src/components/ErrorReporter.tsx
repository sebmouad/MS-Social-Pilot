'use client';

import { useEffect } from 'react';

const sent = new Set<string>();

/** Send one browser error to root's error list, once per page load per message. */
export function reportBrowserError(error: unknown): void {
  const value = error instanceof Error ? error : new Error(String(error));
  const key = `${value.name}:${value.message}`;
  if (sent.has(key) || sent.size >= 10) return;
  sent.add(key);
  void fetch('/api/errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: value.name.slice(0, 100),
      message: value.message.slice(0, 2000),
      stack: value.stack?.slice(0, 8000),
      path: window.location.pathname,
    }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Catches the errors no boundary sees — event handlers, timers, promises — and
 * reports them (NEXT_PHASES G16). Renders nothing.
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportBrowserError(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportBrowserError(event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
