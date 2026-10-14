import { getLocale, getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';
import { instagramInSelection } from '@/lib/channel-figures';
import { listInstagramAccounts, readInstagramInsights } from '@/lib/instagram';

/** Every stored Instagram account insight for the selected channels, in Overview. */
export async function InstagramMetricsSection({
  workspaceId, selection, from, to,
}: {
  workspaceId: string;
  selection: Parameters<typeof instagramInSelection>[1];
  from: Date;
  to: Date;
}) {
  if (!env.instagramEnabled) return null;
  const t = await getTranslations('analytics');
  const locale = await getLocale();
  const accounts = (await listInstagramAccounts(workspaceId)).filter((account) => instagramInSelection(account, selection));
  if (accounts.length === 0) return null;
  const groups = await Promise.all(accounts.map(async (account) => ({ account, series: await readInstagramInsights({ accountId: account.id, from, to }) })));
  const value = (entry: number | Record<string, number> | null) =>
    typeof entry === 'number' ? entry.toLocaleString(locale) : entry ? Object.entries(entry).map(([key, count]) => `${key}: ${count.toLocaleString(locale)}`).join(' · ') : '—';
  return (
    <section className="space-y-3" aria-label={t('instagramMetrics')}>
      <h2 className="text-lg font-semibold text-slate-900">{t('instagramMetrics')}</h2>
      <p className="text-sm text-slate-600">{t('instagramMetricsHint')}</p>
      {groups.map(({ account, series }) => (
        <details key={account.id} className="card p-4" open={groups.length === 1}>
          <summary className="cursor-pointer font-semibold text-slate-900">@{account.username} · {t('allMetrics', { count: series.length })}</summary>
          <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
            {([
              [t('followers'), account.followersCount],
              [t('instagramFollowing'), account.followsCount],
              [t('instagramMediaCount'), account.mediaCount],
            ] as const).map(([label, count]) => (
              <div key={label}><dt className="text-slate-600">{label}</dt><dd className="font-semibold tabular-nums text-slate-900">{count?.toLocaleString(locale) ?? '—'}</dd></div>
            ))}
          </dl>
          {series.length === 0 ? <p className="mt-3 text-sm text-slate-500">{t('instagramMetricsEmpty')}</p> : (
            <div className="scroll-x mt-3">
              <table className="data-table w-full min-w-[600px] text-sm">
                <thead><tr><th className="px-3 py-2">{t('category')}</th><th className="px-3 py-2">{t('metric')}</th><th className="px-3 py-2">{t('period')}</th><th className="px-3 py-2 text-end">{t('value')}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {series.map((item) => <tr key={`${item.metric}:${item.period}`}>
                    <td className="px-3 py-2 text-slate-500">{item.category}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium" title={item.metric}>{item.label}</span>
                      {item.description && <span className="block text-xs text-slate-500">{item.description}</span>}
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer font-semibold text-brand-700">{t('storedReadings', { count: item.points.length })}</summary>
                        <ol className="mt-1 max-h-52 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
                          {item.points.map((point, index) => <li key={`${point.endTime}:${index}`} className="flex flex-wrap justify-between gap-x-3"><time dateTime={point.endTime}>{new Date(point.endTime).toLocaleDateString(locale)}</time><span className="font-medium tabular-nums">{value(point.value)}</span></li>)}
                        </ol>
                      </details>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{item.period}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{value(item.latest)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}
        </details>
      ))}
    </section>
  );
}
