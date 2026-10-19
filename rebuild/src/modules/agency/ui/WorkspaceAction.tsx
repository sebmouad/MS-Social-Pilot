'use client';
import { useState } from 'react';
import { Button } from '@/components/Button';
import styles from './agency.module.css';

/** Switches the signed-in session to one administered workspace, then opens the destination there. */
export function WorkspaceAction({ workspaceId, workspaceName, href, label, variant = 'secondary' }: { workspaceId: string; workspaceName: string; href: string; label: string; variant?: 'primary' | 'secondary' | 'quiet' }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    if (pending) return;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/workspaces/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId }) });
      if (!response.ok) throw new Error('select');
      window.location.assign(href);
    } catch {
      setError(`Could not switch to ${workspaceName}. Check your connection and try again.`);
      setPending(false);
    }
  }
  return <span className={styles.action}>
    <Button size="sm" variant={variant} disabled={pending} aria-label={`${label}: ${workspaceName}`} onClick={() => void open()}>{pending ? 'Opening…' : label}</Button>
    {error && <span role="alert" className={styles.actionError}>{error}</span>}
  </span>;
}
