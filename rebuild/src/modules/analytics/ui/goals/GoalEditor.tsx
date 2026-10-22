'use client';

import { useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { RouteNotice } from '@/components/RouteNotice';
import { goalsText, type GoalsCatalog, type GoalsCopyKey, type GoalsLocale } from '@/modules/analytics/goals/copy';
import styles from './goals.module.css';

type Metric = { metric: string; label: string; value: number | null };

export function GoalEditor({ locale, channelId, channelName, metrics, copy }: { copy?: GoalsCatalog; locale: GoalsLocale; channelId: string; channelName: string; metrics: Metric[] }) {
  const t = (key: GoalsCopyKey, values?: Record<string, string | number>) => goalsText(locale, key, values, copy);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(metrics.map(m => [m.metric, m.value === null ? '' : String(m.value)])));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const say = (text: string, error = false) => {
    setNotice(v => ({ error, text, key: (v?.key ?? 0) + 1 }));
    if (error) toast.failed(text, () => window.location.reload(), t('refresh'));
    else toast.notify({ title: text, tone: 'success' });
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const goals: Record<string, number | null> = {};
    for (const m of metrics) {
      const raw = (values[m.metric] ?? '').trim();
      if (!raw) { goals[m.metric] = null; continue; }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 100_000_000) { say(t('invalid', { label: m.label }), true); return; }
      goals[m.metric] = n;
    }
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch('/api/analytics/goals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channelId, goals, confirmation: `SET ANALYTICS GOALS ${channelId}` }) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.ok !== true) throw new Error(result && typeof result.error === 'string' ? result.error : t('saveFailed'));
      say(t('saved')); window.location.reload();
    } catch (error) { say(error instanceof Error ? error.message : t('unknown'), true); }
    finally { setBusy(false); inFlight.current = false; }
  }

  return <form noValidate onSubmit={save} className={styles.form} aria-label={t('formLabel', { channel: channelName })}>
    <div className={styles.fields}>{metrics.map(m => <label key={m.metric}>{t('perMonth', { label: m.label })}
      <input type="number" inputMode="numeric" min={1} max={100000000} step={1} value={values[m.metric] ?? ''} placeholder={t('noGoal')}
        onChange={e => setValues(v => ({ ...v, [m.metric]: e.target.value }))} disabled={busy} />
    </label>)}</div>
    <div className={styles.foot}><Button type="submit" size="sm" disabled={busy}>{busy ? t('saving') : t('save')}</Button></div>
    {notice && <RouteNotice error={notice.error} focusKey={`goals:${channelId}:${notice.key}`}>{notice.text}</RouteNotice>}
  </form>;
}
