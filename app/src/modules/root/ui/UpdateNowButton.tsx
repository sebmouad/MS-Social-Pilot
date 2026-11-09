'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/Button';

/** Asks the server updater to install the deployed branch's latest commit; the page shows its progress. */
export function UpdateNowButton({ label, requested, failure }: { label: string; requested: string; failure: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function run() {
    if (busy) return;
    setBusy(true); setMessage(null);
    const response = await fetch('/api/root/updates', { method: 'POST' }).catch(() => null);
    setBusy(false);
    setMessage(response?.ok ? { text: requested, error: false } : { text: failure, error: true });
    if (response?.ok) router.refresh();
  }
  return <div>
    <Button variant="primary" busy={busy} leading={<IconRefresh size={16} />} onClick={run}>{label}</Button>
    {message ? <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ui-error' : 'small-note'}>{message.text}</p> : null}
  </div>;
}
