export type AdsReportPolicy = {
  presets: readonly { id: string; days: number; label: string }[];
  defaultPreset: string;
  maxRangeDays: number;
  maxFilterCharacters: number;
};

export const ADS_REPORT_DEFAULT_POLICY: AdsReportPolicy = {
  presets: [
    { id: '7d', days: 7, label: 'Last 7 days' },
    { id: '30d', days: 30, label: 'Last 30 days' },
    { id: '90d', days: 90, label: 'Last 90 days' },
  ],
  defaultPreset: '30d',
  maxRangeDays: 366,
  maxFilterCharacters: 200,
};

/** A preset's label in the page language: the shipped « Last N days » presets read « N derniers jours » in French;
 *  labels an operator changed are shown as saved (2026-11-15). */
export function adsPresetLabel(preset: { days: number; label: string }, locale: 'en' | 'fr'): string {
  return locale === 'fr' && /^Last \d+ days$/.test(preset.label) ? `${preset.days} derniers jours` : preset.label;
}
