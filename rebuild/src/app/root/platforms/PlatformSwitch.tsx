'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Switch } from '@/components/Forms';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useRootInterface } from '@/modules/root/ui/RootInterface';

/** Applies through the same audited configuration service used by HTTP and MCP. */
export function PlatformSwitch({ settingKey, name, enabled }: { settingKey: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const copy = useRootInterface();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [current, setCurrent] = useState(enabled);
  const lock = useRef(false);
  useEffect(() => setCurrent(enabled), [enabled]);
  async function change(next: boolean): Promise<string | null> {
    if (lock.current) return copy.saveFailure;
    lock.current = true; setBusy(true);
    try {
      const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: settingKey, value: next }) });
      const body = await response.json();
      if (!response.ok || response.redirected || body?.ok !== true || !Array.isArray(body.values) || !body.values.some((item: { key?: unknown; value?: unknown }) => item?.key === settingKey && item.value === next)) throw new Error();
      setCurrent(next); toast.notify({ title: copy.saved }); router.refresh();
      return null;
    } catch {
      toast.failed(copy.saveFailure, () => router.refresh(), copy.retry);
      return copy.saveFailure;
    } finally { lock.current = false; setBusy(false); }
  }
  return <div className="root-platform__switch">
    <Switch checked={current} label={`${name} · ${copy.module}`} disabled={busy} onChange={next => { if (next) void change(true); else setConfirmOff(true); }} />
    <ConfirmDialog open={confirmOff} title={copy.disableModule} objectName={name} consequence={copy.disableConsequence} confirmLabel={copy.off} cancelLabel={copy.cancel} failureLabel={copy.saveFailure} onConfirm={() => change(false)} onClose={() => setConfirmOff(false)} />
  </div>;
}
