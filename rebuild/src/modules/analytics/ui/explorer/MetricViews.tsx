'use client';
import { workspaceText, workspaceCopyDefaults, type WorkspaceCopy } from '../../workspace-copy';

import { Tabs } from '@/components/Tabs';
import { DataTable } from '@/components/DataTable';
import { TimeSeriesChart } from '@/components/charts';
import { IconChartLine, IconTable } from '@tabler/icons-react';
import { previousSeries } from '../series';

export function MetricViews({ label, points, unit, locale = 'en', previousPoints, copy = workspaceCopyDefaults }: {
  copy?: WorkspaceCopy; label: string; points: Array<{ date: string; value: number }>; unit: string; locale?: 'en' | 'fr'; previousPoints?: Array<{ date: string; value: number | null }>;
}) {
  const t = workspaceText(copy, locale);
  const fr = locale === 'fr';
  const comparison = previousSeries(points, previousPoints, unit);
  const format = (n: number) => `${new Intl.NumberFormat(locale).format(n)}${unit === 'percent' ? '%' : unit === 'multiple' ? '×' : ''}`;
  return <Tabs label={label} items={[
    { id: 'chart', label: t('Chart'), icon: <IconChartLine />, content:
      <TimeSeriesChart locale={locale} label={label} format={unit === 'percent' ? { style: 'percent' } : undefined} series={[{ id: 'metric', name: label, points: points.map(point => ({ t: point.date, v: unit === 'percent' ? point.value / 100 : point.value })), ...(comparison ? { comparison } : {}) }]} /> },
    { id: 'table', label: t('Table'), icon: <IconTable />, content:
      <DataTable caption={label} rows={points} rowKey={point => point.date} emptyMessage={t('No measurements for this period.')}
        emptyAction={<a href="/analytics/explorer">{t('Change filters')}</a>} columns={[
          { key: 'date', label: t('Date (UTC)'), render: point => point.date },
          { key: 'value', label: t('Value'), align: 'end', render: point => format(point.value) },
        ]} /> },
  ]} />;
}
