'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { FeedAvatar } from './FeedPost';

/**
 * "Plan with AI": one brief, a week of drafts on the calendar. Every one is a
 * draft at a suggested time — someone still reads and schedules it.
 */
export function AiPlanner({
  pages,
  defaultPageId,
  tomorrow,
}: {
  pages: Array<{ id: string; name: string; pictureUrl: string | null }>;
  defaultPageId: string | null;
  /** `yyyy-MM-dd` in the workspace's zone. */
  tomorrow: string;
}) {
  const t = useTranslations('calendar');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pageId, setPageId] = useState(defaultPageId ?? pages[0]?.id ?? '');
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(5);
  const [startDay, setStartDay] = useState(tomorrow);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    setDone(null);
  }, []);

  async function plan() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'plan', targetId: pageId, brief: brief.trim(), count, days: 7, startDay }),
    }).catch(() => null);
    setPending(false);
    const body = (await response?.json().catch(() => ({}))) as { created?: number; error?: string; fields?: Record<string, string> } | undefined;
    if (!response?.ok) {
      setError(Object.values(body?.fields ?? {})[0] ?? body?.error ?? tCommon('genericError'));
      return;
    }
    setDone(body?.created ?? 0);
    router.refresh();
  }

  if (pages.length === 0) return null;

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <span aria-hidden>✨</span>
        {t('aiPlan')}
      </button>
      <Dialog
        open={open}
        title={t('aiPlanTitle')}
        onClose={close}
        closeLabel={tCommon('close')}
        footer={
          done !== null ? (
            <button type="button" className="btn-primary" onClick={close}>
              {tCommon('close')}
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={close}>
                {tCommon('cancel')}
              </button>
              <button type="button" className="btn-primary" disabled={pending || brief.trim().length < 3 || !pageId} onClick={() => void plan()}>
                {pending ? t('aiPlanWorking') : t('aiPlanGo', { count })}
              </button>
            </>
          )
        }
      >
        {done !== null ? (
          <div className="space-y-2 text-center">
            <p className="text-4xl" aria-hidden>
              🗓️
            </p>
            <p className="text-[15px] font-semibold text-slate-900">{t('aiPlanDone', { count: done })}</p>
            <p className="text-sm text-slate-600">{t('aiPlanDoneHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{t('aiPlanHint')}</p>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div>
              <p className="label">{t('aiPlanPage')}</p>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    aria-pressed={pageId === page.id}
                    onClick={() => setPageId(page.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-sm font-semibold ${
                      pageId === page.id ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="xs" />
                    {page.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="plan-brief">
                {t('aiPlanBrief')}
              </label>
              <textarea
                id="plan-brief"
                className="input min-h-[90px]"
                maxLength={2000}
                placeholder={t('aiPlanBriefPlaceholder')}
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="label">{t('aiPlanCount')}</span>
                <input type="number" min={1} max={14} className="input" value={count} onChange={(event) => setCount(Math.min(14, Math.max(1, Number(event.target.value) || 1)))} />
              </label>
              <label className="text-sm">
                <span className="label">{t('aiPlanStart')}</span>
                <input type="date" className="input" value={startDay} onChange={(event) => setStartDay(event.target.value)} />
              </label>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
