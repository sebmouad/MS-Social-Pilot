'use client';

import Link from 'next/link';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useLocale, useTranslations } from 'next-intl';

import { AudienceFields } from './AudienceFields';
import type { TargetOption } from './TargetPicker';

export interface WorkspaceOptions {
  requiresApproval: boolean;
  /** 0 Sunday … 6 Saturday. */
  weekStartsOn: number;
  /** Inbox response time counts only these days and hours; no days = all the time. */
  businessDays: number[];
  businessStart: number;
  businessEnd: number;
  utmSource: string;
  utmMedium: string;
  utmCampaignTemplate: string;
  shortenerEnabled: boolean;
  /** Spam-risk guard gap between Pages for the same content; 0 is off. */
  spamGapMinutes: number;
  /** Undo send: seconds "Publish now" waits; 0 is off. */
  undoSendSeconds: number;
  /** Best time per Page: show good times, or also add them to the queue weekly. */
  bestTimeMode: 'suggest' | 'apply';
  /** Default target audience (H0) for Pages that set none of their own. */
  audienceCountries: string[];
  audienceLanguages: string[];
  audienceTimezone: string | null;
  audienceCalendars: string[];
  aiEnabled: boolean;
  aiTone: string;
  aiBrandVoice: string;
}

interface Props {
  workspaceName: string;
  timezone: string;
  timezones: string[];
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
  targets,
  csvTemplate,
  options,
  aiConfigured,
  shortLinkBase,
  canManage,
}: Props) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [name, setName] = useState(workspaceName);
  const [zone, setZone] = useState(timezone);
  const [settings, setSettings] = useState<WorkspaceOptions>(options);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function saveWorkspace() {
    setPending(true);
    setStatus(null);
    try {
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
      if (response.ok) router.refresh();
    } catch {
      setStatus({ kind: 'error', text: t('networkError') });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {status && (
        <div
          role={status.kind === 'ok' ? 'status' : 'alert'}
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
          <div>
            <label className="label" htmlFor="weekStartsOn">
              {t('weekStartsOn')}
            </label>
            <select
              id="weekStartsOn"
              className="input"
              value={settings.weekStartsOn}
              onChange={(event) => setSettings({ ...settings, weekStartsOn: Number(event.target.value) })}
            >
              {/* 2024-01-07 was a Sunday: day d of the week is 7 + d. */}
              {[1, 0, 6].map((day) => (
                <option key={day} value={day}>
                  {new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + day)))}
                </option>
              ))}
            </select>
            <p className="hint">{t('weekStartsOnHint')}</p>
          </div>
        </div>
        <fieldset className="mt-4">
          <legend className="label">{t('businessHours')}</legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
              const on = settings.businessDays.includes(day);
              return (
                <label key={day} className={`cursor-pointer rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'bg-brand-50 text-brand-600' : 'bg-white text-slate-700 shadow-surface'}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() =>
                      setSettings({
                        ...settings,
                        businessDays: on ? settings.businessDays.filter((d) => d !== day) : [...settings.businessDays, day].sort(),
                      })
                    }
                  />
                  {new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + day)))}
                </label>
              );
            })}
          </div>
          {settings.businessDays.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <label htmlFor="businessStart">{t('businessFrom')}</label>
              <select
                id="businessStart"
                className="input w-auto"
                value={settings.businessStart}
                onChange={(event) => setSettings({ ...settings, businessStart: Number(event.target.value) })}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>{`${String(hour).padStart(2, '0')}:00`}</option>
                ))}
              </select>
              <label htmlFor="businessEnd">{t('businessTo')}</label>
              <select
                id="businessEnd"
                className="input w-auto"
                value={settings.businessEnd}
                onChange={(event) => setSettings({ ...settings, businessEnd: Number(event.target.value) })}
              >
                {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                  <option key={hour} value={hour}>{`${String(hour % 24).padStart(2, '0')}:00`}</option>
                ))}
              </select>
            </div>
          )}
          <p className="hint">{t('businessHoursHint')}</p>
        </fieldset>
        <div className="mt-4 sm:max-w-xs">
          <label className="label" htmlFor="spamGapMinutes">
            {t('spamGap')}
          </label>
          <select
            id="spamGapMinutes"
            className="input"
            value={settings.spamGapMinutes}
            onChange={(event) => setSettings({ ...settings, spamGapMinutes: Number(event.target.value) })}
          >
            {[0, 10, 20, 30, 60, 120].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? t('spamGapOff') : t('spamGapMinutes', { minutes })}
              </option>
            ))}
          </select>
          <p className="hint">{t('spamGapHint')}</p>
        </div>
        <div className="mt-4 sm:max-w-xs">
          <label className="label" htmlFor="undoSendSeconds">
            {t('undoSend')}
          </label>
          <select
            id="undoSendSeconds"
            className="input"
            value={settings.undoSendSeconds}
            onChange={(event) => setSettings({ ...settings, undoSendSeconds: Number(event.target.value) })}
          >
            {[0, 10, 20, 30, 45, 60].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds === 0 ? t('undoSendOff') : t('undoSendSeconds', { seconds })}
              </option>
            ))}
          </select>
          <p className="hint">{t('undoSendHint')}</p>
        </div>
        <div className="mt-4 sm:max-w-xs">
          <label className="label" htmlFor="bestTimeMode">
            {t('bestTimeMode')}
          </label>
          <select
            id="bestTimeMode"
            className="input"
            value={settings.bestTimeMode}
            onChange={(event) => setSettings({ ...settings, bestTimeMode: event.target.value as WorkspaceOptions['bestTimeMode'] })}
          >
            <option value="suggest">{t('bestTimeSuggest')}</option>
            <option value="apply">{t('bestTimeApply')}</option>
          </select>
          <p className="hint">{t('bestTimeModeHint')}</p>
        </div>
        <fieldset className="mt-6">
          <legend className="text-sm font-semibold text-slate-900">{t('audienceTitle')}</legend>
          <p className="mb-2 text-xs text-slate-500">{t('audienceHint')}</p>
          <AudienceFields
            idPrefix="workspace-audience"
            value={{
              countries: settings.audienceCountries,
              languages: settings.audienceLanguages,
              timezone: settings.audienceTimezone,
              calendars: settings.audienceCalendars,
            }}
            onChange={(audience) =>
              setSettings({
                ...settings,
                audienceCountries: audience.countries,
                audienceLanguages: audience.languages,
                audienceTimezone: audience.timezone,
                audienceCalendars: audience.calendars,
              })
            }
            timezones={timezones}
          />
        </fieldset>
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
            {t('aiNotConfigured')}
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
              {(['friendly', 'professional', 'playful', 'urgent', 'informative'] as const).map((tone) => (
                <option key={tone} value={tone}>
                  {t(`tones.${tone}`)}
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

      {/* The queue moved to Schedule → Queue, next to the suggestions drawn
          from the pages' results. One place to edit it, not two. */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{t('queue')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('queueMoved')}</p>
        </div>
        <Link href="/queue" className="btn-secondary">
          {t('openQueue')}
        </Link>
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

    try {
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
    } catch {
      // Some rows may have been scheduled before the connection dropped; the
      // posts list is where to check, and the message does not claim otherwise.
      setError(t('networkError'));
    } finally {
      setPending(false);
    }
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
          className="mb-2 block w-full text-sm text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
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
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
