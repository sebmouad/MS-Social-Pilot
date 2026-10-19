import type { AdsSummary } from '@/modules/ads/server/summary';
import { StoredFields } from './stored-fields';

type DailyMetric = AdsSummary['dailyMetrics'][number];

function validDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function reportDay(value: unknown) {
  const date = validDate(value);
  if (!date) return { label: 'Report day unavailable', dateTime: undefined };
  const dateTime = date.toISOString().slice(0, 10);
  return { label: `${dateTime} UTC`, dateTime };
}

function fetchedAt(value: unknown) {
  const date = validDate(value);
  return date ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'Fetch time unavailable';
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
    : 'Not reported';
}

function amount(value: unknown, currency: string | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not reported';
  const formatted = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return currency ? `${currency} ${formatted}` : `${formatted} (currency unavailable)`;
}

function ratio(value: unknown, percent = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not reported';
  return `${count(value)}${percent ? '%' : ''}`;
}

export function DailyMetrics({ rows, currency }: { rows: readonly DailyMetric[]; currency: string | null }) {
  if (!rows.length) return <p>No daily measures stored.</p>;

  return <div className="ads-daily-metrics">
    {rows.map((day, index) => {
      const dayLabel = reportDay(day.date);
      return <details className="ads-day-details" key={`${dayLabel.dateTime ?? 'unknown'}:${index}`}>
        <summary>{dayLabel.label}</summary>
        <div className="ads-detail-content">
          <div className="ads-field-group"><h5>Delivery measures</h5><dl>
              <div><dt>Report day (UTC)</dt><dd>{dayLabel.dateTime ? <time dateTime={dayLabel.dateTime}>{dayLabel.label}</time> : dayLabel.label}</dd></div>
              <div><dt>Fetched at (UTC)</dt><dd>{fetchedAt(day.fetchedAt)}</dd></div>
              <div><dt>Currency</dt><dd>{currency || 'Currency unavailable'}</dd></div>
              <div><dt>Spend</dt><dd>{amount(day.spend, currency)}</dd></div>
              <div><dt>Impressions</dt><dd>{count(day.impressions)}</dd></div>
              <div><dt>Clicks</dt><dd>{count(day.clicks)}</dd></div>
              <div><dt>Reach (daily, non-additive)</dt><dd>{count(day.reach)}</dd></div>
              <div><dt>CPC</dt><dd>{amount(day.cpc, currency)}</dd></div>
              <div><dt>CPM</dt><dd>{amount(day.cpm, currency)}</dd></div>
              <div><dt>CPP</dt><dd>{amount(day.cpp, currency)}</dd></div>
              <div><dt>CTR</dt><dd>{ratio(day.ctr, true)}</dd></div>
              <div><dt>Frequency</dt><dd>{ratio(day.frequency)}</dd></div>
            </dl></div>
          <StoredFields actions={day.actions} fields={day.fields} />
        </div>
      </details>;
    })}
  </div>;
}
