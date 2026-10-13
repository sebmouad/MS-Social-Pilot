import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { requireRoot } from '@/lib/auth';
import { AGENCY_COLUMNS, AGENCY_WINDOW_DAYS, agencyOverview, sortAgency, type AgencyColumn } from '@/lib/agency';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.agency.title');
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Every workspace's health side by side, sortable, each row opening the workspace. */
export default async function RootAgencyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRoot();
  const t = await getTranslations('root.agency');
  const format = await getFormatter();
  const params = await searchParams;
  const asked = first(params.sort);
  const column: AgencyColumn = (AGENCY_COLUMNS as readonly string[]).includes(asked ?? '') ? (asked as AgencyColumn) : 'name';
  const order = first(params.order) === 'desc' ? 'desc' : first(params.order) === 'asc' ? 'asc' : column === 'name' ? 'asc' : 'desc';
  const rows = sortAgency(await agencyOverview(), column, order);

  const number = (value: number | null) => (value === null ? '—' : format.number(value));
  const signed = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : ''}${format.number(value)}`);
  const money = (value: number | null) => (value === null ? '—' : format.number(value, { style: 'currency', currency: 'USD' }));

  const header = (key: AgencyColumn) => {
    const active = key === column;
    const next = active ? (order === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc';
    return (
      <th
        key={key}
        scope="col"
        aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
        className={`px-3 py-2 font-medium ${key === 'name' ? 'text-start' : 'text-end'}`}
      >
        <Link href={`/root/agency?sort=${key}&order=${next}`} className="hover:text-slate-900 hover:underline">
          {t(`column.${key}`)}
          {active && <span aria-hidden>{order === 'asc' ? ' ↑' : ' ↓'}</span>}
        </Link>
      </th>
    );
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle', { days: AGENCY_WINDOW_DAYS })}</p>
      </header>
      {rows.length === 0 ? (
        <p className="card p-6 text-sm text-slate-600">{t('empty')}</p>
      ) : (
        <div className="card scroll-x p-0">
          <table className="data-table w-full min-w-[48rem] text-sm tabular-nums">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr>{AGENCY_COLUMNS.map(header)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="px-3 py-2 text-start font-semibold">
                    <Link href={`/root/workspaces/${row.id}`} className="text-brand-700 hover:underline">
                      {row.name}
                    </Link>
                    {row.suspended && <span className="badge ms-2 bg-red-100 text-red-700">{t('suspended')}</span>}
                  </th>
                  <td className="px-3 py-2 text-end">{number(row.pages)}</td>
                  <td className={`px-3 py-2 text-end ${row.disconnected > 0 ? 'font-semibold text-red-700' : ''}`}>{number(row.disconnected)}</td>
                  <td className="px-3 py-2 text-end">{number(row.scheduled)}</td>
                  <td className={`px-3 py-2 text-end ${row.failed > 0 ? 'font-semibold text-red-700' : ''}`}>{number(row.failed)}</td>
                  <td className="px-3 py-2 text-end">{signed(row.followers)}</td>
                  <td className="px-3 py-2 text-end">{number(row.engagements)}</td>
                  <td className="px-3 py-2 text-end">{money(row.aiSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">{t('footnote', { days: AGENCY_WINDOW_DAYS })}</p>
    </div>
  );
}
