'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBell, IconHeartbeat } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { SidebarDock } from '@/components/SidebarDock';
import { useConfirm } from '@/components/useConfirm';
import type { AlertCopy } from '../alerts-config';
import type { listSystemAlerts } from '../server/alerts';
import { runAlertAction } from '@/app/root/alerts/actions';

export function SystemAlerts({ snapshot, copy, locale }: { snapshot: Awaited<ReturnType<typeof listSystemAlerts>>; copy: AlertCopy; locale: 'en' | 'fr' }) {
  const router = useRouter(); const busy = useRef(false); const feedback = useRef<HTMLParagraphElement>(null);
  const [pending, setPending] = useState(false); const [message, setMessage] = useState('');
  const [confirm, dialog] = useConfirm({ title: copy.confirmTitle, cancel: copy.cancel, confirm: copy.confirm, danger: false });
  async function run(action: 'test' | 'check') {
    if (busy.current) return;
    const expected = action === 'test' ? 'TEST SYSTEM ALERT' : 'CHECK SYSTEM ALERTS';
    const done = await confirm(copy.consequence, { exactConfirmation: expected, confirmationLabel: copy.confirmation, pendingLabel: copy.pending, failureLabel: copy.failure, onConfirm: async () => {
      if (busy.current) return copy.pending; busy.current = true; setPending(true);
      try {
        const result = await runAlertAction(action, expected);
        if (!result.ok) return copy.failure;
        const outcome = result.value;
        if ('checked' in outcome) setMessage(copy.finished);
        else {
          const status = (value: string) => value === 'sent' || value === 'accepted' ? copy.sent : value === 'uncertain' ? copy.uncertain : value === 'unavailable' ? copy.disabled : copy.failed;
          setMessage(`${copy.email}: ${status(outcome.email)} · ${copy.telegram}: ${status(outcome.telegram)}${outcome.auditRecorded ? '' : ` · ${copy.uncertain}`}`);
        }
        try { router.refresh(); } catch { /* receipt remains confirmed */ }
        return null;
      } catch { return copy.failure; }
      finally { busy.current = false; setPending(false); }
    } });
    if (done) queueMicrotask(() => feedback.current?.focus());
  }
  const names: Record<string, string> = { 'worker.down': copy.worker, 'publish.failures': copy.publish, 'backup.failed': copy.backup, 'disk.full': copy.disk };
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: snapshot.timeZone }).format(new Date(value)) + ` ${snapshot.timeZone}`;
  return <section aria-busy={pending}>
    <SidebarDock><div className="ui-field"><Button disabled={pending} leading={<IconHeartbeat size={18} aria-hidden="true" />} onClick={() => void run('check')}>{copy.run}</Button><Button disabled={pending} leading={<IconBell size={18} aria-hidden="true" />} onClick={() => void run('test')}>{copy.test}</Button></div></SidebarDock>
    <p ref={feedback} tabIndex={-1} role="status" aria-live="polite">{message}</p>
    <DataTable rows={snapshot.items} rowKey={row => row.id} caption={copy.title} emptyMessage={copy.empty} zebra={false} columns={[
      { key: 'key', label: copy.key, render: row => <strong>{names[row.key] ?? row.key}</strong> },
      { key: 'opened', label: copy.opened, render: row => date(row.openedAt) },
      { key: 'resolved', label: copy.resolved, render: row => row.resolvedAt ? date(row.resolvedAt) : copy.active },
    ]} />{dialog}
  </section>;
}
