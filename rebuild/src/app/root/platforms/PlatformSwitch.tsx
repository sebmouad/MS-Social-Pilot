'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Switch one platform module on or off through the Root configuration API. */
export function PlatformSwitch({ settingKey, name, enabled }: { settingKey: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(next: boolean) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: settingKey, value: next }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'The change could not be saved.'); }
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The change could not be saved.'); }
    finally { setBusy(false); }
  }

  return <div className="root-platform__switch">
    <button type="button" role="switch" aria-checked={enabled} aria-label={`${name} module`} disabled={busy} onClick={() => change(!enabled)}>
      <span aria-hidden="true" />{busy ? 'Saving…' : enabled ? 'On' : 'Off'}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
