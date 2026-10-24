'use client';
import { useEffect, useRef, useState } from 'react';
import { IconHistory } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components';
import { useToast } from '@/components/Toast';
import type { RootInterfaceCopy } from '@/lib/config/root-interface-copy';

type History = { items: Array<{ id: string; action: string; createdAt: string; actor: { name: string; email: string } | null }>; olderCursor: string | null };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function isHistory(value: unknown): value is History {
  return record(value) && (value.olderCursor === null || typeof value.olderCursor === 'string') && Array.isArray(value.items) && value.items.every(item => record(item) && typeof item.id === 'string' && typeof item.action === 'string' && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) && (item.actor === null || record(item.actor) && typeof item.actor.name === 'string' && typeof item.actor.email === 'string'));
}

/** Reads the same sanitized, bounded audit service as installation HTTP and MCP. */
export function ConfigHistory({ copy }: { copy: RootInterfaceCopy }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<History | null>(null);
  const [cursor, setCursor] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const toast = useToast();
  const toastRef = useRef(toast); toastRef.current = toast;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setBusy(true); setError(false); setData(null);
    const query = new URLSearchParams({ q: 'config.changed', ...(cursor ? { cursor } : {}) });
    void fetch(`/api/root/activity?${query}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const value: unknown = await response.json();
      if (!response.ok || !isHistory(value)) throw new Error();
      if (!controller.signal.aborted) setData({ ...value, items: value.items.filter(item => item.action === 'config.changed') });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setError(true);
        toastRef.current.failed(copy.historyFailure, () => setRevision(value => value + 1), copy.retry);
      }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, cursor, revision, copy]);
  return <>
    <Button leading={<IconHistory size={18} />} onClick={() => { setCursor(''); setOpen(true); }}>{copy.history}</Button>
    <Drawer open={open} title={copy.history} description={copy.historyDescription} closeLabel={copy.close} onClose={() => setOpen(false)}>
      <div aria-busy={busy}>
        {error ? <EmptyState title={copy.historyFailure} icon={<IconHistory />} action={<Button onClick={() => setRevision(value => value + 1)}>{copy.retry}</Button>} />
          : data ? <>{data.items.length ? <ol>{data.items.map(item => <li key={item.id}><time dateTime={item.createdAt}>{item.createdAt}</time>{item.actor && <p>{item.actor.name}</p>}</li>)}</ol>
            : <EmptyState title={copy.historyEmpty} icon={<IconHistory />} action={<a href="/root/activity?q=config.changed">{copy.historyLink}</a>} />}
            {data.olderCursor && <Button onClick={() => setCursor(data.olderCursor!)}>{copy.historyMore}</Button>}
            {cursor && <Button onClick={() => setCursor('')}>{copy.historyLatest}</Button>}
          </> : <p role="status">{copy.history}</p>}
        <p><a href="/root/activity?q=config.changed">{copy.historyLink}</a></p>
      </div>
    </Drawer>
  </>;
}
