'use client';
import { useRef, useState } from 'react';
import { IconDeviceMobile } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import { INSTALL_CONFIRMATION } from './protocol';
import type { WebAppCopy } from './config';
import { useWebApp } from './Registration';

export function InstallControl({ copy: t, canWrite, requestTimeoutMs }: { copy: WebAppCopy; canWrite: boolean; requestTimeoutMs: number }) {
  const { prompt, installed, clearPrompt } = useWebApp();
  const ready = prompt !== null;
  const inFlight = useRef(false);
  const [prepared, setPrepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, dialog] = useConfirm({ title: t.confirmTitle, cancel: t.cancel, confirm: t.confirm, danger: false });
  async function prepare() {
    if (inFlight.current || !canWrite) return;
    inFlight.current = true;
    try {
      if (!await confirm(t.confirmDetail)) return;
      setBusy(true); setMessage('');
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch('/api/settings/web-app', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: INSTALL_CONFIRMATION }) });
        if (!response.ok || (await response.json()).prepared !== true) throw new Error('refused');
        setPrepared(true); setMessage(t.prepared);
      } finally { window.clearTimeout(timer); }
    } catch { setMessage(t.failed); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function install() {
    const current = prompt;
    if (!current || !prepared || inFlight.current || !canWrite) return;
    inFlight.current = true; setBusy(true);
    // Keep prompt() in the direct user gesture; awaiting an HTTP call first loses browser activation.
    try {
      await current.prompt();
      const choice = await current.userChoice;
      setMessage(choice.outcome === 'accepted' ? t.prepared : t.dismissed);
    } catch { setMessage(t.failed); }
    finally { clearPrompt(); setBusy(false); inFlight.current = false; }
  }
  return <div>
    <p>{installed ? t.installed : t.detail}</p>
    {!installed && canWrite ? <Button leading={<IconDeviceMobile size={20} />} busy={busy} disabled={busy} onClick={() => void (prepared && ready ? install() : prepare())}>{busy ? t.preparing : prepared && ready ? t.install : t.prepare}</Button> : null}
    {!installed && !ready ? <p>{t.unsupported}</p> : null}
    <p role="status" aria-live="polite">{message}</p>
    {dialog}
  </div>;
}
