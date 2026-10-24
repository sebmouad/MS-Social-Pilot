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
