import { demographicsCopyDefaults, type DemographicsCopy } from '../../demographics/copy';
import { AudiencePyramid, BarChart } from '@/components/charts';
import { buildPyramid } from './pyramid';

type Row = { label: string; value: number | null };

/**
 * One chart for a stored breakdown: a pyramid when every category is an age range for one of two
 * genders, otherwise horizontal bars of the categories exactly as stored (already bounded by Root).
 */
export function AudienceChart({ label, rows, locale, copy = demographicsCopyDefaults }: { copy?: DemographicsCopy; label: string; rows: readonly Row[]; locale: 'en' | 'fr' }) {
  if (!rows?.length) return null;
  const pyramid = buildPyramid(rows);
  if (pyramid) {
    return <AudiencePyramid locale={locale} label={label} groups={pyramid.groups}
      left={{ name: copy.Women[locale], values: pyramid.left }} right={{ name: copy.Men[locale], values: pyramid.right }} />;
  }
  const sorted = [...rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return <BarChart locale={locale} label={label} orientation="horizontal" categories={sorted.map(row => row.label)}
    series={[{ id: 'value', name: label, values: sorted.map(row => row.value) }]} />;
}
