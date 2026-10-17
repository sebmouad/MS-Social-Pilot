import type { AdsFilters } from '@/server/ads/queries';
import { CsvExportButton } from '@/components/CsvExportButton';

const DAY = 86_400_000;

export function adsExportHref(filters: AdsFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === 'custom') {
    params.set('start', filters.since.toISOString().slice(0, 10));
    params.set('end', new Date(filters.until.getTime() - DAY).toISOString().slice(0, 10));
  }
  if (filters.accountId) params.set('accountId', filters.accountId);
  return `/api/ads/report/export?${params.toString()}`;
}

export function AdsReportExport({ filters, maxRows, maxBytes, fileName }: { filters: AdsFilters; maxRows: number; maxBytes: number; fileName: string }) {
  return <CsvExportButton
    href={adsExportHref(filters)}
    expectedFormat="ads-daily-v1"
    rowCountHeader="x-msp-row-count"
    maxRows={maxRows}
    maxBytes={maxBytes}
    fileName={fileName}
    requireFileNameConfirmation
    copy={{
      heading: 'Export Ads report',
      help: `Export all matching daily rows across every page, up to ${maxRows.toLocaleString()} rows and ${maxBytes.toLocaleString()} bytes. Action metrics and additional fields are included; sensitive connection fields are redacted.`,
      action: 'Export all matching daily rows',
      pending: 'Preparing CSV…',
      noun: { singular: 'daily row', plural: 'daily rows' },
    }}
  />;
}
