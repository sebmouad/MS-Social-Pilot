'use client';
import { uiCopy, type CustomerCopy, type UiLocale } from './copy';
import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import styles from './agency.module.css';

/** Switches the signed-in session to one administered workspace, then opens the destination there. */
export function WorkspaceAction({ workspaceId, workspaceName, href, label, variant = 'secondary', locale = 'en', copy }: { workspaceId: string; workspaceName: string; href: string; label: string; copy?: CustomerCopy; locale?: UiLocale; variant?: 'primary' | 'secondary' | 'quiet' }) {
  const t = uiCopy(locale, copy);
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    if (pending) return;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/workspaces/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId, confirmation: `SELECT WORKSPACE ${workspaceId}` }) });
      if (!response.ok) throw new Error('select');
      toast.notify({ title: `${label}: ${workspaceName}` });
      window.location.assign(href);
    } catch {
      const message = t("Could not switch to {0}. Check your connection and try again.", workspaceName);
      setError(message); toast.failed(message, () => void open(), label);
      setPending(false);
    }
  }
  return <span className={styles.action}>
    <Button size="sm" variant={variant} busy={pending} disabled={pending} aria-label={`${label}: ${workspaceName}`} onClick={() => void open()}>{pending ? t("Opening…") : label}</Button>
    {error && <span role="alert" className={styles.actionError}>{error}</span>}
  </span>;
}
