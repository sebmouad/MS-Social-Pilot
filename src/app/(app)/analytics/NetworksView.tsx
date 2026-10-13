import { getTranslations } from 'next-intl/server';

import { StatTile } from '@/components/charts/StatTile';
import { EmptyState } from '@/components/EmptyState';
import { ExternalLink } from '@/components/ExternalLink';
import { NETWORK_LABELS } from '@/lib/networks';
import { readNetworkPosts, totalsByNetwork } from '@/lib/network-analytics';
import type { PageScope } from '@/lib/page-access';
import { appLocale, formatInZone } from '@/lib/time';

/**
 * Posts sent to the networks besides Facebook and Instagram, with the public
 * counters each network reports (likes, reposts, replies), per network and
 * per post. Networks whose counters are not read yet show a dash.
 */
export async function NetworksView({
  workspaceId,
  scope,
  from,
  to,
  timezone,
}: {
  workspaceId: string;
  scope: PageScope;
  from: Date;
  to: Date;
  timezone: string;
}) {
  const t = await getTranslations('networkAnalytics');
  const rows = await readNetworkPosts({ workspaceId, scope, from, to });
  if (rows.length === 0) return <EmptyState icon="analytics" title={t('empty')} hint={t('emptyHint')} />;

  const number = (value: number | null) => (value === null ? '—' : value.toLocaleString(appLocale()));
  return (
    <div className="space-y-6">
      {totalsByNetwork(rows).map((total) => (
        <section key={total.network} aria-label={NETWORK_LABELS[total.network]} className="space-y-2">
          <h2 className="text-[17px] font-bold text-slate-900">{NETWORK_LABELS[total.network]}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={t('posts')} value={total.posts} />
            <StatTile label={t('likes')} value={total.likes} />
            <StatTile label={t('reposts')} value={total.reposts} />
            <StatTile label={t('replies')} value={total.replies} />
          </div>
        </section>
      ))}
      <p className="text-xs text-slate-500">{t('note')}</p>

      <div className="card scroll-x">
        <table className="data-table w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3">{t('post')}</th>
              <th className="px-4 py-3">{t('channel')}</th>
              <th className="px-4 py-3 text-end">{t('likes')}</th>
              <th className="px-4 py-3 text-end">{t('reposts')}</th>
              <th className="px-4 py-3 text-end">{t('replies')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="max-w-[320px] px-4 py-2.5">
                  <p className="truncate text-slate-900">{row.message || t('noText')}</p>
                  <p className="text-xs text-slate-500">
                    {formatInZone(row.publishedAt, timezone)}
                    {row.url && (
                      <>
                        {' · '}
                        <ExternalLink href={row.url} className="font-semibold text-brand-600 hover:underline">
                          {t('open')}
                        </ExternalLink>
                      </>
                    )}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {NETWORK_LABELS[row.network]} · {row.channel}
                </td>
                <td className="px-4 py-2.5 text-end">{number(row.likes)}</td>
                <td className="px-4 py-2.5 text-end">{number(row.reposts)}</td>
                <td className="px-4 py-2.5 text-end">{number(row.replies)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
