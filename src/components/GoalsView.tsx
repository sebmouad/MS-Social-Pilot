import { getFormatter, getTranslations } from 'next-intl/server';

import { goalPercent, type GoalPace } from '@/lib/goals';
import type { PageGoals } from '@/lib/page-goals';

const PACE_TONE: Record<GoalPace, { bar: string; text: string }> = {
  met: { bar: 'bg-emerald-500', text: 'text-emerald-700' },
  onTrack: { bar: 'bg-brand-500', text: 'text-brand-700' },
  behind: { bar: 'bg-amber-500', text: 'text-amber-800' },
  noData: { bar: 'bg-slate-300', text: 'text-slate-500' },
};

/** Each Page's monthly goals as progress bars with their pace. */
export async function GoalsView({ pages, showNames = true }: { pages: PageGoals[]; showNames?: boolean }) {
  const t = await getTranslations('goals');
  const format = await getFormatter();

  return (
    <div className="space-y-4">
      {pages.map((page) => (
        <div key={page.targetId} className="space-y-2.5">
          {showNames && <h3 className="text-sm font-semibold text-slate-900">{page.name}</h3>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {page.goals.map((goal) => {
              const percent = goalPercent(goal.target, goal.actual);
              const tone = PACE_TONE[goal.pace];
              const label = t(`metric_${goal.metric}`);
              return (
                <li key={goal.metric} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-700">{label}</span>
                    <span className={`text-xs font-semibold ${tone.text}`}>{t(`pace_${goal.pace}`)}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-900">
                    {t('progress', {
                      actual: goal.actual === null ? '—' : format.number(goal.actual),
                      target: format.number(goal.target),
                    })}
                  </p>
                  <div
                    role="progressbar"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                  >
                    <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${percent}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
