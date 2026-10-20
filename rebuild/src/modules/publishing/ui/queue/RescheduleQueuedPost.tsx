'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { useConfirm } from '@/components/useConfirm';
import { bulkConfirmation } from '@/modules/publishing/bulk';
import { wallTimeToInstant } from '@/lib/calendar-dates';

const COPY = {
  en: { action: 'Reschedule', title: 'Reschedule this post?', cancel: 'Cancel', confirm: 'Move post', date: 'Date', time: 'Time', exact: 'Type to confirm', pending: 'Moving…', error: 'The move could not be confirmed. Refresh the queue and check this post before trying again.', invalid: 'Choose a valid future time in the workspace time zone.', success: 'Post rescheduled.', zone: 'Workspace time zone', review: 'Review new time', from: 'Current time', to: 'New time' },
  fr: { action: 'Reprogrammer', title: 'Reprogrammer cette publication ?', cancel: 'Annuler', confirm: 'Déplacer la publication', date: 'Date', time: 'Heure', exact: 'Saisissez pour confirmer', pending: 'Déplacement…', error: 'Le déplacement n’a pas pu être confirmé. Actualisez la file et vérifiez cette publication avant de réessayer.', invalid: 'Choisissez une heure future valide dans le fuseau de l’espace de travail.', success: 'Publication reprogrammée.', zone: 'Fuseau de l’espace de travail', review: 'Vérifier le nouvel horaire', from: 'Horaire actuel', to: 'Nouvel horaire' },
};

/** Uses the same bounded reschedule service as HTTP and MCP bulk_post_action. */
export function RescheduleQueuedPost({ postId, date: initialDate, time: initialTime, timeZone, text }: { postId: string; date: string; time: string; timeZone: string; text: string }) {
  const router = useRouter();
  const validation = useFormValidation();
  const [locale, setLocale] = useState<'en' | 'fr'>('en');
  useEffect(() => { setLocale(document.documentElement.lang.startsWith('fr') ? 'fr' : 'en'); }, []);
  const copy = COPY[locale];
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirm, dialog] = useConfirm({ title: copy.title, cancel: copy.cancel, confirm: copy.confirm, danger: false });

  return <details>
    <summary>{copy.action}</summary>
    <p>{copy.zone}: {timeZone}</p>
    <form noValidate onSubmit={async event => {
      event.preventDefault();
      if (!validation.validate(event.currentTarget, { ...(!date ? { date: copy.invalid } : {}), ...(!time ? { time: copy.invalid } : {}) })) return;
      setError(''); setNotice('');
      const instant = wallTimeToInstant(date, time, timeZone);
      if (!instant.ok || instant.instant.getTime() <= Date.now()) { setError(copy.invalid); return; }
      const moved = await confirm(`${text}\n${copy.from}: ${initialDate} ${initialTime}\n${copy.to}: ${date} ${time} (${timeZone})`, {
        exactConfirmation: bulkConfirmation('reschedule', 1), confirmationLabel: copy.exact, pendingLabel: copy.pending, failureLabel: copy.error,
        onConfirm: async () => {
          const response = await fetch('/api/publishing/posts/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reschedule', postIds: [postId], requestId: crypto.randomUUID(), confirmation: bulkConfirmation('reschedule', 1), date, time }) });
          const body = await response.json().catch(() => null);
          // A 200 bulk response can contain a failed/skipped/uncertain item.
          if (!response.ok || body?.action !== 'reschedule' || body.requested !== 1 || body.done !== 1 || body.failed !== 0 || body.skipped !== 0 || body.needsReview !== 0 || !Array.isArray(body.items) || body.items.length !== 1 || body.items[0].postId !== postId || body.items[0].outcome !== 'done') return copy.error;
          return null;
        },
      });
      if (moved) { setNotice(copy.success); router.refresh(); }
    }}>
      <label className="ui-field"><span>{copy.date}</span><input className="ui-input" type="date" name="date" required value={date} onChange={event => setDate(event.target.value)} {...validation.fieldProps('date')} /><FieldError {...validation.errorProps('date')} /></label>
      <label className="ui-field"><span>{copy.time}</span><input className="ui-input" type="time" name="time" required value={time} onChange={event => setTime(event.target.value)} {...validation.fieldProps('time')} /><FieldError {...validation.errorProps('time')} /></label>
      <Button type="submit" size="sm">{copy.review}</Button>
      {error && <p role="alert">{error}</p>}
    </form>
    <p role="status">{notice}</p>
    {dialog}
  </details>;
}
