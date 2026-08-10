'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { WEEKDAY_NAMES } from '@/lib/time';
import type { TargetOption } from './TargetPicker';

interface Slot {
  dayOfWeek: number;
  hour: number;
  minute: number;
}

interface Props {
  workspaceName: string;
  timezone: string;
  timezones: string[];
  slots: Slot[];
  targets: TargetOption[];
  csvTemplate: string;
}

export function SettingsClient({ workspaceName, timezone, timezones, slots, targets, csvTemplate }: Props) {
  const router = useRouter();

  const [name, setName] = useState(workspaceName);
  const [zone, setZone] = useState(timezone);
  const [currentSlots, setCurrentSlots] = useState<Slot[]>(slots);
  const [newSlot, setNewSlot] = useState<Slot>({ dayOfWeek: 1, hour: 9, minute: 0 });
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function saveWorkspace() {
    setPending(true);
    setStatus(null);
    const response = await fetch('/api/workspace', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, timezone: zone }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setStatus(
      response.ok
        ? { kind: 'ok', text: 'Workspace settings saved.' }
        : { kind: 'error', text: body.error ?? 'Could not save.' },
    );
    setPending(false);
    if (response.ok) router.refresh();
  }

  async function saveSlots(next: Slot[]) {
    setPending(true);
    setStatus(null);
    const response = await fetch('/api/queue-slots', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slots: next }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.ok) {
      setCurrentSlots(next);
      setStatus({ kind: 'ok', text: 'Publishing times updated.' });
      router.refresh();
    } else {
      setStatus({ kind: 'error', text: body.error ?? 'Could not save the queue.' });
    }
    setPending(false);
  }

  const sorted = [...currentSlots].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour || a.minute - b.minute,
  );

  return (
    <div className="space-y-6">
      {status && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            status.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {status.text}
        </div>
      )}

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Workspace</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="workspaceName">
              Name
            </label>
            <input
              id="workspaceName"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="timezone">
              Timezone
            </label>
            <select
              id="timezone"
              className="input"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
            >
              {timezones.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <p className="hint">
              Every scheduled time you enter is interpreted in this timezone, and stays correct across
              daylight saving changes.
            </p>
          </div>
        </div>
        <button type="button" className="btn-primary mt-4" onClick={saveWorkspace} disabled={pending}>
          Save workspace
        </button>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Publishing queue</h2>
        <p className="mt-1 text-sm text-slate-600">
          Recurring times for “add to the next queue slot”. Each new post takes the earliest free slot.
        </p>

        <ul className="mt-4 flex flex-wrap gap-2">
          {sorted.length === 0 && <li className="text-sm text-slate-500">No times set yet.</li>}
          {sorted.map((slot) => (
            <li
              key={`${slot.dayOfWeek}-${slot.hour}-${slot.minute}`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            >
              <span className="text-slate-700">
                {WEEKDAY_NAMES[slot.dayOfWeek]?.slice(0, 3)} {String(slot.hour).padStart(2, '0')}:
                {String(slot.minute).padStart(2, '0')}
              </span>
              <button
                type="button"
                aria-label="Remove slot"
                className="text-slate-400 hover:text-red-600"
                disabled={pending}
                onClick={() =>
                  saveSlots(
                    currentSlots.filter(
                      (entry) =>
                        !(
                          entry.dayOfWeek === slot.dayOfWeek &&
                          entry.hour === slot.hour &&
                          entry.minute === slot.minute
                        ),
                    ),
                  )
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="slotDay">
              Day
            </label>
            <select
              id="slotDay"
              className="input"
              value={newSlot.dayOfWeek}
              onChange={(event) => setNewSlot({ ...newSlot, dayOfWeek: Number(event.target.value) })}
            >
              {WEEKDAY_NAMES.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="slotTime">
              Time
            </label>
            <input
              id="slotTime"
              type="time"
              className="input"
              value={`${String(newSlot.hour).padStart(2, '0')}:${String(newSlot.minute).padStart(2, '0')}`}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(':');
                setNewSlot({
                  ...newSlot,
                  hour: Number.parseInt(hour ?? '9', 10),
                  minute: Number.parseInt(minute ?? '0', 10),
                });
              }}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => saveSlots([...currentSlots, newSlot])}
          >
            Add time
          </button>
        </div>
      </section>

      <BulkUpload targets={targets} timezone={zone} csvTemplate={csvTemplate} />
    </div>
  );
}

function BulkUpload({
  targets,
  timezone,
  csvTemplate,
}: {
  targets: TargetOption[];
  timezone: string;
  csvTemplate: string;
}) {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<{
    total: number;
    scheduled: number;
    failed: number;
    results: Array<{ row: number; status: string; message?: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    setPending(true);
    setError(null);
    setSummary(null);

    const response = await fetch('/api/posts/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv, targetIds: selected, timezone, publishMode: 'worker' }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };

    if (!response.ok) {
      setError(body.error ?? 'The upload failed.');
    } else {
      setSummary(body as never);
      router.refresh();
    }
    setPending(false);
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">Bulk schedule from CSV</h2>
      <p className="mt-1 text-sm text-slate-600">
        Columns: <code className="rounded bg-slate-100 px-1">message, link, scheduled_at, media_url</code>.
        Leave <code className="rounded bg-slate-100 px-1">scheduled_at</code> empty to use the next free
        queue slot. Dates are read in {timezone}.
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-brand-600">Show an example</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          {csvTemplate}
        </pre>
      </details>

      <div className="mt-4">
        <label className="label" htmlFor="csvInput">
          Paste or upload CSV
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          className="mb-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) setCsv(await file.text());
          }}
        />
        <textarea
          id="csvInput"
          className="input min-h-[120px] font-mono text-xs"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder="message,link,scheduled_at,media_url"
        />
      </div>

      <div className="mt-4">
        <span className="label">Destinations</span>
        <div className="flex flex-wrap gap-2">
          {targets
            .filter((target) => target.canPublish)
            .map((target) => (
              <label
                key={target.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-500"
                  checked={selected.includes(target.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(target.id)
                        ? current.filter((id) => id !== target.id)
                        : [...current, target.id],
                    )
                  }
                />
                {target.name}
              </label>
            ))}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
          <p className="font-medium text-slate-900">
            {summary.scheduled} of {summary.total} rows scheduled
            {summary.failed > 0 ? `, ${summary.failed} failed` : ''}.
          </p>
          {summary.failed > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-600">
              {summary.results
                .filter((result) => result.status === 'error')
                .map((result) => (
                  <li key={result.row}>
                    Row {result.row}: {result.message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        className="btn-primary mt-4"
        disabled={pending || !csv.trim() || selected.length === 0}
        onClick={upload}
      >
        {pending ? 'Scheduling…' : 'Schedule all rows'}
      </button>
    </section>
  );
}
