import { DataTable } from '@/components/DataTable';
import type { AdsComparisonResult } from '../../analysis/server';
import { adsKpiLabel, adsText, type AdsAnalysisCopy, type AdsLocale } from '../../analysis/copy';

type ObjectRow = AdsComparisonResult['groups'][number]['objects'][number];
/** Same exact-object figures exposed by the comparison HTTP/MCP service and CSV export. */
export function ObjectPerformance({ row, locale, currency, compare, copy }: {
  copy?: AdsAnalysisCopy; row: Pick<ObjectRow, 'name' | 'kpis' | 'trend'>; locale: AdsLocale; currency: string | null; compare: boolean;
}) {
  const t = (key: Parameters<typeof adsText>[1]) => adsText(locale, key, {}, copy);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  const formatDay = (value: string) => {
    const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(parsed) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed) : value;
  };
  const show = (n: number | null, key: string) => {
    if (n === null) return t('unknown');
    if (['spend', 'cpc', 'cpm'].includes(key) && currency) {
      try { return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n); } catch { /* fall back */ }
    }
    return `${['spend', 'cpc', 'cpm'].includes(key) && currency ? `${currency} ` : ''}${number.format(n)}${key === 'ctr' ? '%' : ''}`;
  };
  return <details><summary>{t('objectPerformance')} · {row.name}</summary>
    {compare && <DataTable caption={`${t('comparePrevious')} · ${row.name}`} rows={row.kpis} rowKey={k => k.key} columns={[
      { key: 'metric', label: t('metric'), render: k => adsKpiLabel(locale, k.key, copy) },
      { key: 'current', label: t('currentPeriod'), render: k => show(k.current, k.key) },
      { key: 'previous', label: t('previousPeriod'), render: k => show(k.previous, k.key) },
      { key: 'change', label: t('change'), render: k => k.changePercent === null ? t('unknown') : `${k.changePercent > 0 ? '+' : ''}${number.format(k.changePercent)}%` },
    ]} />}
    <p className="small-note">{t('trendNote')}</p>
    <DataTable caption={`${t('dailyCaption')} · ${row.name}`} rows={row.trend} rowKey={day => day.date} columns={[
      { key: 'date', label: t('day'), render: day => formatDay(day.date) },
      ...(['spend', 'impressions', 'clicks', 'cpc', 'cpm', 'ctr'] as const).map(key => ({ key, label: adsKpiLabel(locale, key, copy), render: (day: ObjectRow['trend'][number]) => show(day[key], key) })),
    ]} />
  </details>;
}
