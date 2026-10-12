import { TargetType } from '@prisma/client';
import { getLocale, getTranslations } from 'next-intl/server';

import { FeedAvatar } from './FeedPost';
import { prisma } from '@/lib/prisma';
import { analysePage } from '@/lib/page-analysis-data';
import { compact } from '@/lib/viz';

const DAY = 24 * 60 * 60 * 1000;
const KEYS = ['posts', 'interactions', 'reach', 'netFollows'] as const;
const PROFILE_CHANGE =
  /(a changé sa photo de (profil|couverture)|a mis à jour sa photo de (profil|couverture)|updated (his|her|their|its) (profile|cover) (picture|photo)|changed (his|her|their|its) (profile|cover) (picture|photo))/i;

/**
 * The portal's "Results": each Page's last 30 days in four figures, against
 * the 30 before, and the post that did best. What a client asks on a call,
 * answered before the call.
 */
export async function PortalResults({ link }: { link: { workspaceId: string; pageIds: string[]; workspace: { timezone: string } } }) {
  const t = await getTranslations('share');
  const tKpi = await getTranslations('pageAnalysis.kpi');
  const locale = await getLocale();
  const pages = await prisma.target.findMany({
    where: { workspaceId: link.workspaceId, type: TargetType.page, ...(link.pageIds.length ? { id: { in: link.pageIds } } : {}) },
    orderBy: { name: 'asc' },
    select: { id: true },
    take: 12,
  });
  const to = new Date();
  const from = new Date(to.getTime() - 30 * DAY);
  // Four at a time: twelve Pages one after another kept a client waiting.
  const results: Awaited<ReturnType<typeof analysePage>>[] = [];
  for (let index = 0; index < pages.length; index += 4) {
    results.push(
      ...(await Promise.all(
        pages.slice(index, index + 4).map((page) =>
          analysePage({ workspaceId: link.workspaceId, targetId: page.id, from, to, timeZone: link.workspace.timezone }),
        ),
      )),
    );
  }

  if (results.length === 0) return <div className="card p-8 text-center text-sm text-slate-600">{t('empty')}</div>;

  return (
    <div className="space-y-4">
      {results.map((result) => {
        // A new profile or cover picture is a "post" to Facebook, not one to show a client.
        const best = result.top.find((post) => !PROFILE_CHANGE.test(post.message));
        return (
          <section key={result.page.id} className="card overflow-hidden">
            <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <FeedAvatar name={result.page.name} pictureUrl={result.page.pictureUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-slate-900">{result.page.name}</span>
                {result.page.followers !== null && (
                  <span className="block text-xs text-slate-500">{t('followers', { count: result.page.followers })}</span>
                )}
              </span>
              {result.health.score !== null && (
                <span className="nums rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700" title={t('healthHint')}>
                  {result.health.score}/100
                </span>
              )}
            </header>
            <dl className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
              {KEYS.map((key) => {
                const kpi = result.kpis.find((entry) => entry.key === key);
                const good = kpi?.change !== null && kpi?.change !== undefined ? kpi.change >= 0 : null;
                return (
                  <div key={key} className="bg-white px-4 py-3">
                    <dt className="text-xs font-semibold text-slate-500">{tKpi(key)}</dt>
                    <dd className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-xl font-bold text-slate-900">{kpi?.current === null || kpi?.current === undefined ? '—' : compact(kpi.current, locale)}</span>
                      {kpi?.change !== null && kpi?.change !== undefined && (
                        <span className={`nums text-xs font-semibold ${good ? 'text-emerald-700' : 'text-red-700'}`}>
                          {kpi.change >= 0 ? '↑' : '↓'} {Math.abs(kpi.change)}%
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {best && (
              <div className="flex items-start gap-3 border-t border-slate-100 px-4 py-3">
                {best.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={best.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-slate-500">{t('bestPost')}</span>
                  <span className="line-clamp-2 text-sm text-slate-800 [overflow-wrap:anywhere]">{best.message || '—'}</span>
                  <span className="nums block text-xs text-slate-500">
                    {t('bestPostFigures', { count: best.reactions + best.comments + best.shares })}
                  </span>
                </span>
              </div>
            )}
          </section>
        );
      })}
      <p className="text-center text-xs text-slate-500">{t('resultsFoot')}</p>
    </div>
  );
}
