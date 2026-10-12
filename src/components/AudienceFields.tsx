'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { COUNTRY_CODES, CULTURAL_CALENDARS, canonicalLanguage, type Audience } from '@/lib/audience';

import { Icon } from './Icon';

/** Names in the reader's language, falling back to the code itself. */
function useNames() {
  const locale = useLocale();
  return useMemo(() => {
    const regions = new Intl.DisplayNames([locale], { type: 'region' });
    const languages = new Intl.DisplayNames([locale], { type: 'language' });
    return {
      country: (code: string) => regions.of(code) ?? code,
      language: (tag: string) => {
        try {
          return languages.of(tag) ?? tag;
        } catch {
          return tag;
        }
      },
    };
  }, [locale]);
}

function Chips({ items, label, onRemove, removeLabel }: { items: string[]; label: (item: string) => string; onRemove: (item: string) => void; removeLabel: (name: string) => string }) {
  if (items.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 ps-2.5 pe-1 text-sm text-brand-800" suppressHydrationWarning>
          {label(item)}
          <button type="button" className="rounded-full p-1 hover:bg-brand-100" suppressHydrationWarning aria-label={removeLabel(label(item))} onClick={() => onRemove(item)}>
            <Icon name="close" size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Target audience (NEXT_PHASES H0): countries, languages, time zone and
 * cultural calendars. Used for a Page (with the workspace's defaults shown as
 * what it follows) and for the workspace's defaults themselves.
 */
export function AudienceFields({
  idPrefix,
  value,
  onChange,
  timezones,
  inherited,
  suggestion,
}: {
  idPrefix: string;
  value: Audience;
  onChange: (value: Audience) => void;
  timezones: string[];
  /** For a Page: what it follows when a part is empty. */
  inherited?: Audience & { timezone: string };
  /** For a Page: what its own followers suggest. */
  suggestion?: { countries: string[]; languages: string[] };
}) {
  const t = useTranslations('audience');
  const names = useNames();
  const [languageDraft, setLanguageDraft] = useState('');
  const [languageError, setLanguageError] = useState(false);

  const countries = useMemo(
    () => COUNTRY_CODES.filter((code) => !value.countries.includes(code)).map((code) => ({ code, name: names.country(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    [value.countries, names],
  );

  function addLanguage() {
    const tag = canonicalLanguage(languageDraft);
    if (!tag) {
      setLanguageError(true);
      return;
    }
    setLanguageError(false);
    setLanguageDraft('');
    if (!value.languages.includes(tag)) onChange({ ...value, languages: [...value.languages, tag] });
  }

  const follows = (items: string[], label: (item: string) => string) =>
    inherited && items.length > 0 ? <p className="hint">{t('follows', { value: items.map(label).join(', ') })}</p> : null;

  const fresh = suggestion && {
    countries: suggestion.countries.filter((code) => !value.countries.includes(code)),
    languages: suggestion.languages.filter((tag) => !value.languages.includes(tag)),
  };

  return (
    <div className="space-y-4">
      {fresh && (fresh.countries.length > 0 || fresh.languages.length > 0) && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span>
            {t('suggested', { value: [...fresh.countries.map(names.country), ...fresh.languages.map(names.language)].join(', ') })}
          </span>
          <button
            type="button"
            className="font-medium text-brand-600 hover:underline"
            onClick={() =>
              onChange({ ...value, countries: [...value.countries, ...fresh.countries], languages: [...value.languages, ...fresh.languages] })
            }
          >
            {t('useSuggested')}
          </button>
        </p>
      )}

      <div>
        <label className="label" htmlFor={`${idPrefix}-country`}>
          {t('countries')}
        </label>
        <Chips
          items={value.countries}
          label={names.country}
          removeLabel={(name) => t('remove', { name })}
          onRemove={(code) => onChange({ ...value, countries: value.countries.filter((item) => item !== code) })}
        />
        <select
          id={`${idPrefix}-country`}
          className="input"
          value=""
          onChange={(event) => event.target.value && onChange({ ...value, countries: [...value.countries, event.target.value] })}
        >
          <option value="">{t('addCountry')}</option>
          {countries.map((country) => (
            // Node and the browser carry different ICU data, so a name can differ by a word.
            <option key={country.code} value={country.code} suppressHydrationWarning>
              {country.name}
            </option>
          ))}
        </select>
        {value.countries.length === 0 && follows(inherited?.countries ?? [], names.country)}
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-language`}>
          {t('languages')}
        </label>
        <Chips
          items={value.languages}
          label={(tag) => `${names.language(tag)} (${tag})`}
          removeLabel={(name) => t('remove', { name })}
          onRemove={(tag) => onChange({ ...value, languages: value.languages.filter((item) => item !== tag) })}
        />
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-language`}
            className="input"
            placeholder={t('languagePlaceholder')}
            value={languageDraft}
            aria-invalid={languageError}
            aria-describedby={`${idPrefix}-language-hint`}
            onChange={(event) => setLanguageDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addLanguage();
              }
            }}
          />
          <button type="button" className="btn-secondary shrink-0" onClick={addLanguage} disabled={!languageDraft.trim()}>
            {t('addLanguage')}
          </button>
        </div>
        <p id={`${idPrefix}-language-hint`} className={languageError ? 'mt-1 text-xs text-red-700' : 'hint'} role={languageError ? 'alert' : undefined}>
          {languageError ? t('languageInvalid') : t('languageHint')}
        </p>
        {value.languages.length === 0 && follows(inherited?.languages ?? [], names.language)}
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-timezone`}>
          {t('timezone')}
        </label>
        <select
          id={`${idPrefix}-timezone`}
          className="input"
          value={value.timezone ?? ''}
          onChange={(event) => onChange({ ...value, timezone: event.target.value || null })}
        >
          <option value="">{inherited ? t('timezoneFollows', { zone: inherited.timezone }) : t('timezoneWorkspace')}</option>
          {timezones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p className="hint">{t('timezoneHint')}</p>
      </div>

      <fieldset>
        <legend className="label">{t('calendars')}</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CULTURAL_CALENDARS.map((calendar) => (
            <label key={calendar} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={value.calendars.includes(calendar)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    calendars: event.target.checked ? [...value.calendars, calendar] : value.calendars.filter((item) => item !== calendar),
                  })
                }
              />
              {t(`calendar.${calendar}`)}
            </label>
          ))}
        </div>
        <p className="hint">
          {value.calendars.length === 0 && inherited && inherited.calendars.length > 0
            ? t('follows', { value: inherited.calendars.map((calendar) => t(`calendar.${calendar}`)).join(', ') })
            : t('calendarsHint')}
        </p>
      </fieldset>
    </div>
  );
}
