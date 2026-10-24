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
  return raw;
}

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
  const sorted = [...rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return <BarChart locale={locale} label={label} orientation="horizontal" categories={sorted.map(row => formatAudienceLabel(row.label, locale, copy))}
    series={[{ id: 'value', name: label, values: sorted.map(row => row.value) }]} />;
}
