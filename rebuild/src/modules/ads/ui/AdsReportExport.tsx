'use client';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';
import type { AdsFilters } from '@/modules/ads/server/queries';
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
  const t = useAdsText();
  return <CsvExportButton
    href={adsExportHref(filters)}
    expectedFormat="ads-daily-v1"
    rowCountHeader="x-msp-row-count"
    maxRows={maxRows}
    maxBytes={maxBytes}
    fileName={fileName}
    requireFileNameConfirmation
    copy={{
      heading: t('text196'),
      help: t('text197', { value0: maxRows.toLocaleString(), value1: maxBytes.toLocaleString() }),
      action: t('text198'),
      pending: t('text199'),
      noun: { singular: t('text046'), plural: t('dailyRows') },
    }}
  />;
}
