'use client';

import { usePublishingCopy } from '../kit/CopyProvider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { useConfirm } from '@/components/useConfirm';
import { bulkConfirmation } from '@/modules/publishing/bulk';
import { wallTimeToInstant } from '@/lib/calendar-dates';



/** Uses the same bounded reschedule service as HTTP and MCP bulk_post_action. */
export function RescheduleQueuedPost({ postId, date: initialDate, time: initialTime, timeZone, text }: { postId: string; date: string; time: string; timeZone: string; text: string }) {
  const router = useRouter();
  const validation = useFormValidation();
  const [locale, setLocale] = useState<'en' | 'fr'>('en');
  useEffect(() => { setLocale(document.documentElement.lang.startsWith('fr') ? 'fr' : 'en'); }, []);
  const copy = usePublishingCopy(locale);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirm, dialog] = useConfirm({ title: copy.rescheduleTitle, cancel: copy.rescheduleCancel, confirm: copy.rescheduleConfirm, danger: false });

  return <details>
    <summary>{copy.rescheduleAction}</summary>
    <p>{copy.rescheduleZone}: {timeZone}</p>
    <form noValidate onSubmit={async event => {
      event.preventDefault();
      if (!validation.validate(event.currentTarget, { ...(!date ? { date: copy.rescheduleInvalid } : {}), ...(!time ? { time: copy.rescheduleInvalid } : {}) })) return;
      setError(''); setNotice('');
      const instant = wallTimeToInstant(date, time, timeZone);
      if (!instant.ok || instant.instant.getTime() <= Date.now()) { setError(copy.rescheduleInvalid); return; }
      const moved = await confirm(`${text}\n${copy.rescheduleFrom}: ${initialDate} ${initialTime}\n${copy.rescheduleTo}: ${date} ${time} (${timeZone})`, {
        exactConfirmation: bulkConfirmation('reschedule', 1), confirmationLabel: copy.rescheduleExact, pendingLabel: copy.reschedulePending, failureLabel: copy.rescheduleError,
        onConfirm: async () => {
          const response = await fetch('/api/publishing/posts/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reschedule', postIds: [postId], requestId: crypto.randomUUID(), confirmation: bulkConfirmation('reschedule', 1), date, time }) });
          const body = await response.json().catch(() => null);
          // A 200 bulk response can contain a failed/skipped/uncertain item.
          if (!response.ok || body?.action !== 'reschedule' || body.requested !== 1 || body.done !== 1 || body.failed !== 0 || body.skipped !== 0 || body.needsReview !== 0 || !Array.isArray(body.items) || body.items.length !== 1 || body.items[0].postId !== postId || body.items[0].outcome !== 'done') return copy.rescheduleError;
          return null;
        },
      });
      if (moved) { setNotice(copy.rescheduleSuccess); router.refresh(); }
    }}>
      <label className="ui-field"><span>{copy.rescheduleDate}</span><input className="ui-input" type="date" name="date" required value={date} onChange={event => setDate(event.target.value)} {...validation.fieldProps('date')} /><FieldError {...validation.errorProps('date')} /></label>
      <label className="ui-field"><span>{copy.rescheduleTime}</span><input className="ui-input" type="time" name="time" required value={time} onChange={event => setTime(event.target.value)} {...validation.fieldProps('time')} /><FieldError {...validation.errorProps('time')} /></label>
      <Button type="submit" size="sm">{copy.rescheduleReview}</Button>
      {error && <p role="alert">{error}</p>}
    </form>
    <p role="status">{notice}</p>
    {dialog}
  </details>;
}
