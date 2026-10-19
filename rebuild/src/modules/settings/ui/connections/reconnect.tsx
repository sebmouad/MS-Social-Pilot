'use client';

import { useState } from 'react';
import styles from '@/modules/settings/ui/settings.module.css';

/** Starts the same authorization the Connect button uses; the platform module decides what it asks for. */
export function ReconnectButton({ platformId, label, busyLabel, failedLabel }: { platformId: string; label: string; busyLabel: string; failedLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function reconnect() {
    setBusy(true); setFailed(false);
    try {
      const response = await fetch(`/api/connections/${encodeURIComponent(platformId)}/start`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.authorizationUrl !== 'string') throw new Error('start');
      const authorizationUrl = new URL(result.authorizationUrl);
      if (authorizationUrl.protocol !== 'https:' && authorizationUrl.hostname !== 'localhost') throw new Error('start');
      window.location.assign(authorizationUrl.toString());
    } catch { setFailed(true); setBusy(false); }
  }
  return <>
    <button type="button" className={styles['settings-row-actions__link']} onClick={reconnect} disabled={busy}>{busy ? busyLabel : label}</button>
    {failed && <span role="alert" className={styles['settings-table__secondary']}>{failedLabel}</span>}
  </>;
}
