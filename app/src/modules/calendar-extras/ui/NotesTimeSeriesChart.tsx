'use client';
import { ChartShell, type ChartModel } from '@/components/charts/ChartShell';
import { buildTimeSeriesModel, type TimeSeriesChartProps } from '@/components/charts/TimeSeriesChart';
import { toTime } from '@/components/charts/format';
import { fillTimes } from '@/components/charts/series-fit';
import { colorAt } from '@/components/charts/theme';
import { workspaceDateKey } from '@/lib/calendar-dates';
import type { Note } from '../contracts';
import type { Copy } from '../copy';
export type NotesChartProps = TimeSeriesChartProps & { notes: Note[]; noteColors: string[]; copy: Pick<Copy, 'notesCaption' | 'global'> };
export function buildNotesTimeSeriesModel(props: NotesChartProps): ChartModel {
 const base = buildTimeSeriesModel(props);
 // Same axis as the base chart: every day between the first and last point, so note marks line up with the gaps.
 const times = fillTimes([...new Set(props.series.flatMap(s => s.points.map(p => toTime(p.t))).filter(Number.isFinite))].sort((a, b) => a - b), props.granularity ?? 'day');
 const days = times.map(t => workspaceDateKey(new Date(t), props.timeZone ?? 'UTC'));
 return { ...base, signature: `${base.signature}:${JSON.stringify(props.notes)}`,
  table: { columns: [...base.table.columns, props.copy.notesCaption], rows: base.table.rows.map((row, i) => [...row, props.notes.filter(n => n.day === days[i]).map(n => n.label).join('; ')]) },
  option: env => {
   const option = base.option(env);
   const lines = option.series as Array<Record<string, unknown>>;
   return { ...option, series: lines.map((line, i) => i ? line : ({ ...line, markLine: { symbol: 'none', silent: true, label: { show: false }, data: props.notes.flatMap(n => {
    const index = days.indexOf(n.day);
    return index < 0 ? [] : [{ name: n.label, xAxis: index, lineStyle: { type: 'dashed', color: colorAt(env.theme, Math.max(0, props.noteColors.indexOf(n.color))) } }];
   }) } })) };
  },
 };
}
/** Mount in Analytics with notes obtained from listCalendarEntries(actor, 'notes', appliedFilters). */
export function NotesTimeSeriesChart(props: NotesChartProps) {
 return <section><ChartShell {...props} model={buildNotesTimeSeriesModel(props)} />
  {props.notes.length > 0 && <details><summary>{props.copy.notesCaption}</summary><ul>{props.notes.map(n => <li key={n.id}><time dateTime={n.day}>{new Intl.DateTimeFormat(props.locale ?? 'en', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${n.day}T12:00:00Z`))}</time> — {n.label}{n.targetId === null ? ` · ${props.copy.global}` : ''}</li>)}</ul></details>}
 </section>;
}
