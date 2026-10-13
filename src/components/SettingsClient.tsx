'use client';

import Link from 'next/link';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useLocale, useTranslations } from 'next-intl';

import { AudienceFields } from './AudienceFields';


export interface WorkspaceOptions {
  requiresApproval: boolean;
  clientApprovalAfterTeam: boolean;
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
  /** Negative-comment alert (H15). */
  watchNegativeComments: boolean;
  aiTone: string;
  aiBrandVoice: string;
  aiAvoidWords: string;
}

interface Props {
  workspaceName: string;
  timezone: string;
  timezones: string[];
  options: WorkspaceOptions;
  /** Whether a supported writing provider is connected. */
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
        {settings.requiresApproval && (
          <label className="mt-3 ms-6 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500"
              checked={settings.clientApprovalAfterTeam}
              onChange={(event) => setSettings({ ...settings, clientApprovalAfterTeam: event.target.checked })}
            />
            <span>
              {t('clientAfterTeam')}
              <span className="block text-xs text-slate-500">{t('clientAfterTeamHint')}</span>
            </span>
          </label>
        )}

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
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500"
            checked={settings.watchNegativeComments}
            disabled={!settings.aiEnabled}
            onChange={(event) => setSettings({ ...settings, watchNegativeComments: event.target.checked })}
          />
          <span>
            {t('watchNegativeComments')}
            <span className="block text-xs text-slate-500">{t('watchNegativeCommentsHint')}</span>
          </span>
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
          <div className="sm:col-span-2">
            <label className="label" htmlFor="aiAvoidWords">
              {t('aiAvoidWords')}
            </label>
            <input
              id="aiAvoidWords"
              className="input"
              value={settings.aiAvoidWords}
              maxLength={1000}
              onChange={(event) => setSettings({ ...settings, aiAvoidWords: event.target.value })}
            />
            <p className="hint">{t('aiAvoidWordsHint')}</p>
          </div>
        </div>

        <button type="button" className="btn-primary mt-4" onClick={saveWorkspace} disabled={pending}>
          {tCommon('save')}
        </button>
      </section>

        </>
      )}

      {/* Left in for everyone: uploading a spreadsheet of posts creates posts,
          which is what a contributor is for. They face review like any other. */}
      <Link href="/compose/import" className="btn-secondary">{t('openBulkImport')}</Link>
    </div>
  );
}
