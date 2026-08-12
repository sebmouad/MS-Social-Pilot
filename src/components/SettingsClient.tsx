'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useTranslations } from 'next-intl';

import { WEEKDAY_NAMES } from '@/lib/time';
import type { TargetOption } from './TargetPicker';

interface Slot {
  dayOfWeek: number;
  hour: number;
  minute: number;
}

export interface WorkspaceOptions {
  requiresApproval: boolean;
  utmSource: string;
  utmMedium: string;
  utmCampaignTemplate: string;
  shortenerEnabled: boolean;
  aiEnabled: boolean;
  aiTone: string;
  aiBrandVoice: string;
}

interface Props {
  workspaceName: string;
  timezone: string;
  timezones: string[];
  slots: Slot[];
  targets: TargetOption[];
  csvTemplate: string;
  options: WorkspaceOptions;
  /** False when the server has no ANTHROPIC_API_KEY. */
  aiConfigured: boolean;
  shortLinkBase: string;
  /**
   * False for contributors, who may write posts but not change the workspace.
   *
   * The API refuses them either way — that is the boundary. This only stops
   * them being shown a form where every Save comes back 403, which reads as a
   * broken product rather than as a permission.
   */
  canManage: boolean;
}

export function SettingsClient({
  workspaceName,
  timezone,
  timezones,
  slots,
  targets,
  csvTemplate,
  options,
  aiConfigured,
  shortLinkBase,
  canManage,
}: Props) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [name, setName] = useState(workspaceName);
  const [zone, setZone] = useState(timezone);
  const [settings, setSettings] = useState<WorkspaceOptions>(options);
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
      body: JSON.stringify({ name, timezone: zone, ...settings }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      released?: { released: number; publishingNow: number };
    };

    // Turning review off frees everything it was holding, and anything whose
    // moment has gone publishes within the next tick. "Saved" alone lets
    // somebody find that out from a client.
    const publishingNow = body.released?.publishingNow ?? 0;

    setStatus(
      response.ok
        ? {
            kind: 'ok',
            text: publishingNow > 0 ? t('savedReleased', { count: publishingNow }) : t('saved'),
          }
        : { kind: 'error', text: body.error ?? t('couldNotSave') },
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
      setStatus({ kind: 'ok', text: t('queueUpdated') });
      router.refresh();
    } else {
      setStatus({ kind: 'error', text: body.error ?? t('couldNotSave') });
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

      {!canManage && (
        <p className="card p-5 text-sm text-slate-600">{t('readOnly')}</p>
      )}

      {canManage && (
        <>
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('workspace')}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="workspaceName">
              {t('name')}
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
              {t('timezone')}
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
            <p className="hint">{t('timezoneHint')}</p>
          </div>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500"
            checked={settings.requiresApproval}
            onChange={(event) =>
              setSettings({ ...settings, requiresApproval: event.target.checked })
            }
          />
          <span>
            {t('requireApproval')}
            <span className="block text-xs text-slate-500">{t('requireApprovalHint')}</span>
          </span>
        </label>

        <button type="button" className="btn-primary mt-4" onClick={saveWorkspace} disabled={pending}>
          {t('saveWorkspace')}
        </button>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('linkTagging')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('utmHint')}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="utmSource">
              {t('utmSource')}
            </label>
            <input
              id="utmSource"
              className="input"
              placeholder="facebook"
              value={settings.utmSource}
              onChange={(event) => setSettings({ ...settings, utmSource: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="utmMedium">
              {t('utmMedium')}
            </label>
            <input
              id="utmMedium"
              className="input"
              placeholder="social"
              value={settings.utmMedium}
              onChange={(event) => setSettings({ ...settings, utmMedium: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="utmCampaign">
              {t('utmCampaign')}
            </label>
            <input
              id="utmCampaign"
              className="input"
              placeholder="{month}-{target}"
              value={settings.utmCampaignTemplate}
              onChange={(event) =>
                setSettings({ ...settings, utmCampaignTemplate: event.target.value })
              }
            />
            <p className="hint">{'{date} {month} {year} {target}'}</p>
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500"
            checked={settings.shortenerEnabled}
            onChange={(event) =>
              setSettings({ ...settings, shortenerEnabled: event.target.checked })
            }
          />
          <span>
            {t('shortenLinks')}
            <span className="block text-xs text-slate-500">
              {t('shortenHint')} {shortLinkBase}/l/…
            </span>
          </span>
        </label>

        <button type="button" className="btn-primary mt-4" onClick={saveWorkspace} disabled={pending}>
          {tCommon('save')}
        </button>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('ai')}</h2>
        {!aiConfigured && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No ANTHROPIC_API_KEY is set on this server, so the composer hides these tools.
          </p>
        )}

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-500"
            checked={settings.aiEnabled}
            onChange={(event) => setSettings({ ...settings, aiEnabled: event.target.checked })}
          />
          {t('aiEnabled')}
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="aiTone">
              {t('aiTone')}
            </label>
            <select
              id="aiTone"
              className="input"
              value={settings.aiTone}
              onChange={(event) => setSettings({ ...settings, aiTone: event.target.value })}
            >
              <option value="">{tCommon('none')}</option>
              {['friendly', 'professional', 'playful', 'urgent', 'informative'].map((tone) => (
                <option key={tone} value={tone}>
                  {tone}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="aiBrandVoice">
              {t('aiBrandVoice')}
            </label>
            <textarea
              id="aiBrandVoice"
              className="input min-h-[72px]"
              value={settings.aiBrandVoice}
              onChange={(event) => setSettings({ ...settings, aiBrandVoice: event.target.value })}
            />
            <p className="hint">{t('aiBrandVoiceHint')}</p>
          </div>
        </div>

        <button type="button" className="btn-primary mt-4" onClick={saveWorkspace} disabled={pending}>
          {tCommon('save')}
        </button>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('queue')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('queueSubtitle')}</p>

        <ul className="mt-4 flex flex-wrap gap-2">
          {sorted.length === 0 && <li className="text-sm text-slate-500">{t('noTimes')}</li>}
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
                aria-label={t('removeSlot')}
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
              {t('day')}
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
              {t('time')}
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
            {t('addTime')}
          </button>
        </div>
      </section>
        </>
      )}

      {/* Left in for everyone: uploading a spreadsheet of posts creates posts,
          which is what a contributor is for. They face review like any other. */}
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
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
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
      setError(body.error ?? t('uploadFailed'));
    } else {
      setSummary(body as never);
      router.refresh();
    }
    setPending(false);
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">{t('bulk')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('bulkColumns', { timezone })}</p>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-brand-600">{t('showExample')}</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          {csvTemplate}
        </pre>
      </details>

      <div className="mt-4">
        <label className="label" htmlFor="csvFile">
          {t('uploadCsvFile')}
        </label>
        <input
          id="csvFile"
          type="file"
          accept=".csv,text/csv"
          className="mb-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) setCsv(await file.text());
          }}
        />
        <label className="label" htmlFor="csvInput">
          {t('pasteOrUpload')}
        </label>
        <textarea
          id="csvInput"
          className="input min-h-[120px] font-mono text-xs"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder="message,link,scheduled_at,media_url"
        />
      </div>

      <div className="mt-4">
        <span className="label">{t('bulkDestinations')}</span>
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
            {t('rowsScheduled', { scheduled: summary.scheduled, total: summary.total })}
            {summary.failed > 0 ? t('rowsFailed', { count: summary.failed }) : ''}
          </p>
          {summary.failed > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-600">
              {summary.results
                .filter((result) => result.status === 'error')
                .map((result) => (
                  <li key={result.row}>
                    {t('row')} {result.row}: {result.message}
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
        {pending ? t('scheduling') : t('scheduleAllRows')}
      </button>
    </section>
  );
}
