'use client';
import type { RootErrorCopy } from './config';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';

/** Reversible bookkeeping, so one click rather than a typed phrase. */
export function ResolveError({ id, resolved, copy }: { id: string; resolved: boolean; copy: RootErrorCopy }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggle() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/root/errors/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved: !resolved, confirmation: `${resolved ? 'REOPEN' : 'RESOLVE'} ROOT ERROR ${id}` }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof payload !== 'object' || payload === null || (payload as { ok?: unknown }).ok !== true) setError(copy.saveFailure);
      else router.refresh();
    } catch { setError(copy.saveFailure); } finally { setBusy(false); }
  }
  return <><Button type="button" size="sm" onClick={() => void toggle()} disabled={busy}>{busy ? copy.saving : resolved ? copy.reopen : copy.resolve}</Button>{error && <p role="alert" className="ui-error">{error}</p>}</>;
}
