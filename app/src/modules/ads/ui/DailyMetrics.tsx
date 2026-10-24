'use client';
import { useAdsCatalogs, useAdsText } from '@/modules/ads/ui/AdsCopyProvider';
import type { AdsSummary } from '@/modules/ads/server/summary';
import { StoredFields } from './stored-fields';

type DailyMetric = AdsSummary['dailyMetrics'][number];

function validDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function DailyMetrics({ rows, currency }: { rows: readonly DailyMetric[]; currency: string | null }) {
  const t = useAdsText();
  const { locale } = useAdsCatalogs();
function reportDay(value: unknown) {
  const date = validDate(value);
  if (!date) return { label: t('text175'), dateTime: undefined };
  const dateTime = date.toISOString().slice(0, 10);
  return { label: `${dateTime} UTC`, dateTime };
}

function fetchedAt(value: unknown) {
  const date = validDate(value);
  return date ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : t('text176');
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
    : t('text177');
}

function amount(value: unknown, currency: string | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('text177');
  const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return currency ? `${currency} ${formatted}` : t('currencyUnavailableAmount', { amount: formatted });
}

function ratio(value: unknown, percent = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('text177');
  return `${count(value)}${percent ? '%' : ''}`;
}


  if (!rows.length) return <p>{t('text178')}</p>;

  return <div className="ads-daily-metrics">
    {rows.map((day, index) => {
      const dayLabel = reportDay(day.date);
      return <details className="ads-day-details" key={`${dayLabel.dateTime ?? 'unknown'}:${index}`}>
        <summary>{dayLabel.label}</summary>
        <div className="ads-detail-content">
          <div className="ads-field-group"><h5>{t('text179')}</h5><dl>
              <div><dt>{t('text180')}</dt><dd>{dayLabel.dateTime ? <time dateTime={dayLabel.dateTime}>{dayLabel.label}</time> : dayLabel.label}</dd></div>
              <div><dt>{t('text181')}</dt><dd>{fetchedAt(day.fetchedAt)}</dd></div>
              <div><dt>{t('text182')}</dt><dd>{currency || t('text144')}</dd></div>
              <div><dt>{t('text019')}</dt><dd>{amount(day.spend, currency)}</dd></div>
              <div><dt>{t('text020')}</dt><dd>{count(day.impressions)}</dd></div>
              <div><dt>{t('text022')}</dt><dd>{count(day.clicks)}</dd></div>
              <div><dt>{t('text183')}</dt><dd>{count(day.reach)}</dd></div>
              <div><dt>{t('text023')}</dt><dd>{amount(day.cpc, currency)}</dd></div>
              <div><dt>{t('text024')}</dt><dd>{amount(day.cpm, currency)}</dd></div>
              <div><dt>{t('text184')}</dt><dd>{amount(day.cpp, currency)}</dd></div>
              <div><dt>{t('text025')}</dt><dd>{ratio(day.ctr, true)}</dd></div>
              <div><dt>{t('text185')}</dt><dd>{ratio(day.frequency)}</dd></div>
            </dl></div>
          <StoredFields actions={day.actions} fields={day.fields} />
        </div>
      </details>;
    })}
  </div>;
}
