import { getFormatter, getTranslations } from 'next-intl/server';

import { ChannelsLayout } from '@/components/ChannelsLayout';
import { DateRangePicker } from '@/components/DateRangePicker';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { requirePage } from '@/lib/auth';
import { parseRange } from '@/lib/date-range';
import { readLabelTotals } from '@/lib/label-report';
import { screenMetadata } from '@/lib/metadata';
import { loadSelection } from '@/lib/page-filter';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('campaigns.title');
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Results by label: what each campaign did across the selected channels in the period. */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requirePage();
  const t = await getTranslations('campaigns');
  const format = await getFormatter();
  const params = await searchParams;
  const selection = await loadSelection(auth, params);
  const range = parseRange(
    { range: first(params.range) ?? '30d', from: first(params.from), to: first(params.to), days: first(params.days) },
    auth.workspace.timezone,
  );
  const rows = await readLabelTotals({ workspaceId: auth.workspace.id, targetIds: selection.ids, from: range.from, to: range.to });
  const keep = Object.fromEntries(new URLSearchParams(selection.query));

  return (
    <ChannelsLayout auth={auth} selection={selection} tools={<DateRangePicker range={range} path="/analytics/campaigns" keep={keep} />}>
      <div className="min-w-0 flex-1 space-y-6">
        <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
        {rows.length === 0 ? (
          <EmptyState icon="tag" title={t('emptyTitle')} hint={t('emptyHint')} />
        ) : (
          <div className="card scroll-x">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2">{t('label')}</th>
                  <th className="px-4 py-2 text-end">{t('posts')}</th>
                  <th className="px-4 py-2 text-end">{t('reach')}</th>
                  <th className="px-4 py-2 text-end">{t('interactions')}</th>
                  <th className="px-4 py-2 text-end">{t('clicks')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.labelId}>
                    <td className="px-4 py-2 font-medium text-slate-900">{row.name}</td>
                    <td className="nums px-4 py-2 text-end">{format.number(row.posts)}</td>
                    <td className="nums px-4 py-2 text-end">{format.number(row.reach)}</td>
                    <td className="nums px-4 py-2 text-end">{format.number(row.interactions)}</td>
                    <td className="nums px-4 py-2 text-end">{format.number(row.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">{t('reachNote')}</p>
      </div>
    </ChannelsLayout>
  );
}
