'use client';

import { useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { goalsText, type GoalsCatalog, type GoalsCopyKey, type GoalsLocale } from '@/modules/analytics/goals/copy';
import styles from './goals.module.css';

export type GoalRow = {
  channelId: string; channelName: string;
  /** Current target per trackable metric (null: no goal). */
  targets: Record<string, number | null>;
  /** Progress this month, already formatted on the server. */
  progress: Array<{ metric: string; label: string; text: string; percent: number; pace: string }>;
};

/**
 * Every channel's monthly goals in one table (2026-11-15): the goal names once as column headers, a row per channel
 * with this month's progress, and one Save for all the rows that changed (the API saves one channel at a time).
 */
export function GoalsTable({ locale, rows, metrics, copy, canManage }: { locale: GoalsLocale; rows: GoalRow[]; metrics: Array<{ metric: string; label: string }>; copy?: GoalsCatalog; canManage: boolean }) {
  const t = (key: GoalsCopyKey, values?: Record<string, string | number>) => goalsText(locale, key, values, copy);
  const toast = useToast();
  const initial = () => Object.fromEntries(rows.map(row => [row.channelId, Object.fromEntries(metrics.map(m => [m.metric, row.targets[m.metric] == null ? '' : String(row.targets[m.metric])]))]));
  const [values, setValues] = useState<Record<string, Record<string, string>>>(initial);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const changed = rows.filter(row => metrics.some(m => m.metric in row.targets && (values[row.channelId]?.[m.metric] ?? '') !== (row.targets[m.metric] == null ? '' : String(row.targets[m.metric]))));

  async function save() {
    if (inFlight.current) return;
    if (!changed.length) { toast.notify({ title: t('unchanged') }); return; }
    const payloads: Array<{ row: GoalRow; goals: Record<string, number | null> }> = [];
    for (const row of changed) {
      const goals: Record<string, number | null> = {};
      for (const m of metrics.filter(item => item.metric in row.targets)) {
        const raw = (values[row.channelId]?.[m.metric] ?? '').trim();
        if (!raw) { goals[m.metric] = null; continue; }
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 100_000_000) { toast.failed(`${row.channelName} — ${t('invalid', { label: m.label })}`, () => undefined, t('refresh')); return; }
        goals[m.metric] = n;
      }
      payloads.push({ row, goals });
    }
    inFlight.current = true; setBusy(true);
    const failed: string[] = [];
    for (const { row, goals } of payloads) {
      try {
        const response = await fetch('/api/analytics/goals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channelId: row.channelId, goals, confirmation: `SET ANALYTICS GOALS ${row.channelId}` }) });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || result.ok !== true) failed.push(row.channelName);
      } catch { failed.push(row.channelName); }
    }
    setBusy(false); inFlight.current = false;
    if (failed.length) toast.failed(t('partial', { saved: payloads.length - failed.length, failed: failed.length, names: failed.join(', ') }), () => window.location.reload(), t('refresh'));
    else { toast.notify({ title: payloads.length === 1 ? t('saved') : t('savedCount', { count: payloads.length }), tone: 'success' }); window.location.reload(); }
  }

  return <div className={styles.tableWrap}>
    <table className={styles.table}>
      <thead><tr><th scope="col">{t('channelColumn')}</th>{metrics.map(m => <th key={m.metric} scope="col">{t('perMonth', { label: m.label })}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.channelId} data-changed={changed.includes(row) || undefined}>
        <th scope="row"><span className={styles.rowName}>{row.channelName}</span></th>
        {metrics.map(m => { const p = row.progress.find(item => item.metric === m.metric); if (!(m.metric in row.targets)) return <td key={m.metric}>—</td>; return <td key={m.metric}>
          {canManage ? <input type="number" inputMode="numeric" min={1} max={100000000} step={1} aria-label={`${row.channelName} — ${t('perMonth', { label: m.label })}`}
            value={values[row.channelId]?.[m.metric] ?? ''} placeholder={t('noGoal')} disabled={busy}
            onChange={e => setValues(v => ({ ...v, [row.channelId]: { ...v[row.channelId], [m.metric]: e.target.value } }))} />
            : <span>{row.targets[m.metric] ?? '—'}</span>}
          {p ? <div className={styles.cellProgress} title={`${p.text} · ${p.pace}`}><div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, p.percent)} aria-label={`${p.label} ${p.percent}%`}><i style={{ width: `${Math.min(100, Math.max(0, p.percent))}%` }} /></div><small>{p.text}</small></div> : null}
        </td>; })}
      </tr>)}</tbody>
    </table>
    {canManage ? <div className={styles.foot}><Button variant="primary" disabled={busy || !changed.length} onClick={() => void save()}>{busy ? t('saving') : t('save')}{changed.length > 1 ? ` (${changed.length})` : ''}</Button></div> : null}
  </div>;
}
