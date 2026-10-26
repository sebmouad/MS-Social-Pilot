import { demographicsCopyDefaults, type DemographicsCopy } from '../../demographics/copy';
import { AudiencePyramid, BarChart } from '@/components/charts';
import { buildPyramid } from './pyramid';

type Row = { label: string; value: number | null };

export function formatAudienceLabel(raw: string, locale: 'en' | 'fr', copy: DemographicsCopy = demographicsCopyDefaults): string {
  const ageGender = /^([FMU])[._-](\d{2}-\d{2}|\d{2}\+)$/i.exec(raw.trim());
  if (ageGender) {
    const code = ageGender[1]!.toUpperCase();
    const gender = code === 'F' ? copy.Women[locale] : code === 'M' ? copy.Men[locale] : (locale === 'fr' ? 'Non spécifié' : 'Unspecified');
    return `${gender} · ${ageGender[2]}`;
  }
  if (/^[a-z]{2}_[A-Z]{2}$/.test(raw.trim())) {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(raw.trim().replace('_', '-')) ?? raw;
    } catch { return raw; }
  }
  if (/^[A-Z]{2}$/.test(raw.trim())) {
    try {
      const code = raw.trim() === 'UK' ? 'GB' : raw.trim();
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? raw;
    } catch { return raw; }
  }
  const reaction = REACTIONS[raw.trim().toLowerCase()];
  if (reaction) return reaction[locale];
  return raw;
}

/** Meta reaction keys, including the older names it still returns (sorry = sad, anger = angry). */
const REACTIONS: Record<string, { en: string; fr: string }> = {
  like: { en: 'Like', fr: 'J’aime' }, love: { en: 'Love', fr: 'J’adore' }, care: { en: 'Care', fr: 'Solidaire' }, haha: { en: 'Haha', fr: 'Haha' },
  wow: { en: 'Wow', fr: 'Wouah' }, sad: { en: 'Sad', fr: 'Triste' }, sorry: { en: 'Sad', fr: 'Triste' }, angry: { en: 'Angry', fr: 'Grrr' }, anger: { en: 'Angry', fr: 'Grrr' },
};
/** Bars a chart can label legibly; smaller categories are summed as Other. */
const MAX_BARS = 12;

/**
 * One chart for a stored breakdown: a pyramid when every category is an age range for one of two
 * genders, otherwise horizontal bars of the categories formatted with human-readable labels.
 */
export function AudienceChart({ label, rows, locale, copy = demographicsCopyDefaults }: { copy?: DemographicsCopy; label: string; rows: readonly Row[]; locale: 'en' | 'fr' }) {
  if (!rows?.length) return null;
  const pyramid = buildPyramid(rows);
  if (pyramid) {
    return <AudiencePyramid locale={locale} label={label} groups={pyramid.groups}
      left={{ name: copy.Women[locale], values: pyramid.left }} right={{ name: copy.Men[locale], values: pyramid.right }} />;
  }
  // A breakdown that is all zero says "nothing happened"; an empty chart frame said nothing.
  if (rows.every(row => !row.value)) return <p className="small-note">{locale === 'fr' ? 'Aucune activité sur cette période.' : 'No activity in this period.'}</p>;
  const sorted = [...rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const shown = sorted.length > MAX_BARS ? [...sorted.slice(0, MAX_BARS - 1), { label: locale === 'fr' ? 'Autres' : 'Other', value: sorted.slice(MAX_BARS - 1).reduce((sum, row) => sum + (row.value ?? 0), 0) }] : sorted;
  return <BarChart locale={locale} label={label} orientation="horizontal" categories={shown.map(row => formatAudienceLabel(row.label, locale, copy))}
    series={[{ id: 'value', name: label, values: shown.map(row => row.value) }]} />;
}
