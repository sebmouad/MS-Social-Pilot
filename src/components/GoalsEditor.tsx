'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { GOAL_MAX, GOAL_METRICS, type GoalMetric } from '@/lib/goals';

type Values = Record<GoalMetric, string>;
const EMPTY: Values = { followers: '', views: '', engagements: '', posts: '' };

/** Set a Page's monthly targets. Admins only, like the Page's other settings. */
export function GoalsEditor({ pages }: { pages: Array<{ id: string; name: string }> }) {
  const t = useTranslations('goals');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(pages[0]?.id ?? '');
  const [values, setValues] = useState<Values>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(id: string) {
    setTargetId(id);
    setValues(EMPTY);
    setError(null);
    const response = await fetch(`/api/page-goals?targetId=${encodeURIComponent(id)}`).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { goals?: Partial<Record<GoalMetric, number>> } | undefined;
    if (!response?.ok) return setError(t('loadFailed'));
    setValues(Object.fromEntries(GOAL_METRICS.map((metric) => [metric, body?.goals?.[metric]?.toString() ?? ''])) as Values);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const goals = Object.fromEntries(
      GOAL_METRICS.map((metric) => {
        const raw = values[metric].trim();
        return [metric, raw === '' ? null : Number(raw)];
      }),
    );
    const response = await fetch('/api/page-goals', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId, goals }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) return setError(t('saveFailed'));
    setOpen(false);
    router.refresh();
  }

  if (pages.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={() => {
          setOpen(true);
          void load(targetId || pages[0]!.id);
        }}
      >
        {t('edit')}
      </button>
      <Dialog
        open={open}
        title={t('editTitle')}
        onClose={() => setOpen(false)}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy || !targetId}>
              {t('save')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="goals-page">
              {t('page')}
            </label>
            <select id="goals-page" className="input" value={targetId} onChange={(event) => void load(event.target.value)}>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">{t('editHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {GOAL_METRICS.map((metric) => (
              <div key={metric}>
                <label className="label" htmlFor={`goal-${metric}`}>
                  {t(`metric_${metric}`)}
                </label>
                <input
                  id={`goal-${metric}`}
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={GOAL_MAX}
                  step={1}
                  placeholder={t('none')}
                  value={values[metric]}
                  onChange={(event) => setValues((current) => ({ ...current, [metric]: event.target.value }))}
                />
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
