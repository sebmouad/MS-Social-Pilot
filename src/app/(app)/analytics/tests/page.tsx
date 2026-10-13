import { ScreenHeader } from '@/components/ScreenHeader';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { CaptionTestLearnButton } from '@/components/CaptionTestLearnButton';
import { EmptyState } from '@/components/EmptyState';
import { requirePage } from '@/lib/auth';
import type { CaptionResult } from '@/lib/caption-test';
import { canManageSettings } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('captionTests.title');
}

/**
 * Caption A/B tests: each test with its captions, where they
 * went, and — once the worker has read them — views, engagements and the
 * winner, or why there is none.
 */
export default async function CaptionTestsPage() {
  const auth = await requirePage();
  const t = await getTranslations('captionTests');
  const format = await getFormatter();
  const timeZone = auth.workspace.timezone;

  const tests = await prisma.captionTest.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      posts: {
        orderBy: { captionLabel: 'asc' },
        select: {
          id: true,
          message: true,
          captionLabel: true,
          scheduledAt: true,
          targets: { select: { targetId: true, publishedAt: true, target: { select: { name: true } } } },
        },
      },
    },
  });
  const scope = auth.pageScope;
  // A member limited to some Pages sees the tests that ran only on their Pages.
  const visible = scope.all
    ? tests
    : tests.filter((test) => test.posts.every((post) => post.targets.every((target) => scope.ids.includes(target.targetId))));
  const canLearn = canManageSettings(auth.role);
  const when = (date: Date) => format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const percent = (rate: number | null) => (rate === null ? '—' : format.number(rate, { style: 'percent', maximumFractionDigits: 1 }));

  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('intro')} />

      {visible.length === 0 ? (
        <EmptyState
          icon="analytics"
          title={t('emptyTitle')}
          hint={t('emptyHint')}
          action={
            <Link className="btn-primary" href="/compose">
              {t('emptyAction')}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {visible.map((test) => {
            const results = new Map(((test.results as CaptionResult[] | null) ?? []).map((result) => [result.label, result]));
            const times = test.posts.flatMap((post) => post.targets.map((target) => target.publishedAt ?? post.scheduledAt)).filter(Boolean) as Date[];
            const last = times.length ? new Date(Math.max(...times.map((time) => time.getTime()))) : null;
            const due = last ? new Date(last.getTime() + test.hours * 60 * 60 * 1000) : null;
            return (
              <li key={test.id} className="card space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">{test.name || t('untitled')}</p>
                    <p className="text-xs text-slate-500">{t('started', { date: when(test.createdAt) })}</p>
                  </div>
                  <p className="text-sm" role="status">
                    {test.status === 'running' ? (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800">
                        {due ? t('runningUntil', { date: when(due) }) : t('running')}
                      </span>
                    ) : test.status === 'decided' ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                        {test.lift !== null
                          ? t('winnerLift', { label: test.winnerLabel ?? '', lift: Math.round(test.lift) })
                          : t('winner', { label: test.winnerLabel ?? '' })}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                        {t(`reason.${test.reason ?? 'not_enough_views'}`, { views: test.minViews })}
                      </span>
                    )}
                  </p>
                </div>

                <div className="scroll-x">
                  <table className="data-table w-full min-w-[32rem] text-start text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className="py-1 pe-3 font-medium">{t('caption')}</th>
                        <th scope="col" className="py-1 pe-3 font-medium">{t('pages')}</th>
                        <th scope="col" className="py-1 pe-3 text-end font-medium">{t('views')}</th>
                        <th scope="col" className="py-1 pe-3 text-end font-medium">{t('engagements')}</th>
                        <th scope="col" className="py-1 text-end font-medium">{t('rate')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {test.posts.map((post) => {
                        const result = results.get(post.captionLabel ?? '');
                        const won = test.status === 'decided' && post.captionLabel === test.winnerLabel;
                        return (
                          <tr key={post.id} className={won ? 'bg-emerald-50/60' : undefined}>
                            <td className="max-w-xs py-2 pe-3 align-top">
                              <span className="me-1 font-semibold text-slate-900">{post.captionLabel}</span>
                              {won && <span className="sr-only">{t('winnerShort')}</span>}
                              <span className="line-clamp-2 break-words text-slate-700">{post.message}</span>
                            </td>
                            <td className="py-2 pe-3 align-top text-slate-700">{post.targets.map((target) => target.target.name).join(', ')}</td>
                            <td className="py-2 pe-3 text-end align-top tabular-nums">{result ? format.number(result.views) : '—'}</td>
                            <td className="py-2 pe-3 text-end align-top tabular-nums">{result ? format.number(result.engagements) : '—'}</td>
                            <td className="py-2 text-end align-top tabular-nums">{result ? percent(result.rate) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {test.status === 'decided' &&
                  (test.learnedAt ? (
                    <p className="text-sm text-slate-600">{t('learned')}</p>
                  ) : (
                    canLearn && (
                      <div className="flex flex-wrap items-center gap-2">
                        <CaptionTestLearnButton id={test.id} />
                        <span className="text-xs text-slate-500">{t('learnHint')}</span>
                      </div>
                    )
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
