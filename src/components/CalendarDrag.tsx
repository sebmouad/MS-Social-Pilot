'use client';

import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Drag a planned post to another day (or hour, on the week grid) to move it.
 *
 * The grid is drawn on the server; this only listens. A chip that may be moved
 * carries `data-drag-post` (its id) and `data-drag-time` (`HH:mm`); a square
 * that takes one carries `data-drop-day` (`yyyy-MM-dd`) and, on the week grid,
 * `data-drop-hour`. The minutes are kept; the day, and the hour when given,
 * change. The server checks the move like any other edit.
 */
export function CalendarDrag({ timeZone, todayKey, children }: { timeZone: string; todayKey: string; children: ReactNode }) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const dragged = useRef<{ id: string; time: string } | null>(null);
  const [over, setOver] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const dropTarget = (event: DragEvent) => {
    const square = (event.target as HTMLElement).closest<HTMLElement>('[data-drop-day]');
    return square && (square.dataset.dropDay ?? '') >= todayKey ? square : null;
  };

  const highlight = (square: HTMLElement | null) => {
    if (over === square) return;
    over?.classList.remove('ring-2', 'ring-inset', 'ring-brand-500');
    square?.classList.add('ring-2', 'ring-inset', 'ring-brand-500');
    setOver(square);
  };

  return (
    <div
      onDragStart={(event) => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-drag-post]');
        if (!chip) return;
        dragged.current = { id: chip.dataset.dragPost!, time: chip.dataset.dragTime ?? '09:00' };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', chip.dataset.dragPost!);
        setMessage(null);
      }}
      onDragOver={(event) => {
        if (!dragged.current) return;
        const square = dropTarget(event);
        highlight(square);
        if (square) event.preventDefault();
      }}
      onDragEnd={() => {
        dragged.current = null;
        highlight(null);
      }}
      onDrop={async (event) => {
        const post = dragged.current;
        const square = dropTarget(event);
        dragged.current = null;
        highlight(null);
        if (!post || !square || busy) return;
        event.preventDefault();
        const hour = square.dataset.dropHour;
        const time = hour !== undefined ? `${hour.padStart(2, '0')}:${post.time.slice(3, 5)}` : post.time;
        const at = `${square.dataset.dropDay}T${time}`;
        setBusy(true);
        try {
          const response = await fetch(`/api/posts/${post.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduledAtLocal: at, timezone: timeZone }),
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            setMessage({ tone: 'error', text: body?.error ?? t('moveFailed') });
            return;
          }
          setMessage({ tone: 'ok', text: t('moved', { when: at.replace('T', ' ') }) });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mb-3 rounded-lg px-3 py-2 text-sm ${
            message.tone === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          {message.text}
        </p>
      )}
      {children}
    </div>
  );
}
