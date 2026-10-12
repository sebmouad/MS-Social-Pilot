'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { Audience } from '@/lib/audience';

import { AudienceFields } from './AudienceFields';

/**
 * The two first steps of a new workspace: its basics, then its Pages.
 *
 * Every answer is saved through the same endpoint as Settings, so there is
 * nothing here that Settings cannot change later.
 */
export function WelcomeWizard({
  name: initialName,
  timezone,
  timezones,
  audience: initialAudience,
  pages,
}: {
  name: string;
  timezone: string;
  timezones: string[];
  audience: Audience;
  pages: number;
}) {
  const t = useTranslations('welcome');
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(initialName);
  const [zone, setZone] = useState(timezone);
  const [audience, setAudience] = useState(initialAudience);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new workspace starts on UTC; the browser's own zone is the likelier answer.
  // Read after hydration, because the server cannot know it.
  useEffect(() => {
    if (timezone !== 'UTC') return;
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local && timezones.includes(local)) setZone(local);
  }, [timezone, timezones]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          timezone: zone,
          audienceCountries: audience.countries,
          audienceLanguages: audience.languages,
          audienceTimezone: audience.timezone,
          audienceCalendars: audience.calendars,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t('saveFailed'));
        return;
      }
      router.refresh();
      setStep(2);
    } catch {
      setError(t('saveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        <p className="mt-2 text-xs font-medium text-slate-500">{t('step', { step, total: 2 })}</p>
      </header>

      {step === 1 ? (
        <form onSubmit={save} className="card space-y-4 p-6">
          <h2 className="text-base font-semibold text-slate-900">{t('basicsTitle')}</h2>
          <div>
            <label className="label" htmlFor="welcome-name">
              {t('name')}
            </label>
            <input
              id="welcome-name"
              className="input"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="hint">{t('nameHint')}</p>
          </div>
          <div>
            <label className="label" htmlFor="welcome-timezone">
              {t('timezone')}
            </label>
            <select id="welcome-timezone" className="input" value={zone} onChange={(event) => setZone(event.target.value)}>
              {timezones.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <p className="hint">{t('timezoneHint')}</p>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">{t('audienceTitle')}</legend>
            <p className="mb-2 text-xs text-slate-500">{t('audienceHint')}</p>
            <AudienceFields idPrefix="welcome-audience" value={audience} onChange={setAudience} timezones={timezones} />
          </fieldset>

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/dashboard" className="text-sm font-medium text-slate-600 hover:underline">
              {t('skip')}
            </Link>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? t('saving') : t('continue')}
            </button>
          </div>
        </form>
      ) : (
        <section className="card space-y-4 p-6">
          <h2 className="text-base font-semibold text-slate-900">{t('pagesTitle')}</h2>
          <p className="text-sm text-slate-600">{pages > 0 ? t('pagesConnected', { count: pages }) : t('pagesHint')}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" className="text-sm font-medium text-slate-600 hover:underline" onClick={() => setStep(1)}>
              {t('back')}
            </button>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard" className="btn-secondary">
                {t('finish')}
              </Link>
              <Link href="/connections" className="btn-primary">
                {t('connectPages')}
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
