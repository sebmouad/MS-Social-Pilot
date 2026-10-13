import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SiteFrame } from '@/components/SiteFrame';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { siteIsPublic } from '@/lib/site';

import { readWorkerStatus } from '../api/health/worker';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('site.nav.status');
}

/** Is the app up, and is the scheduler running? Nothing more is public. */
export default async function StatusPage() {
  if (!(await siteIsPublic())) notFound();
  const t = await getTranslations('site.status');
  const database = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const worker = database ? await readWorkerStatus().catch(() => null) : null;
  const rows = [
    { key: 'app', up: database },
    { key: 'scheduler', up: worker?.status === 'ok' },
  ];
  const allUp = rows.every((row) => row.up);
  return (
    <SiteFrame>
      <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
      <p role="status" className={`card mt-6 p-5 font-semibold ${allUp ? 'text-emerald-700' : 'text-amber-700'}`}>
        {allUp ? t('allUp') : t('degraded')}
      </p>
      <ul className="card mt-3 divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between p-4 text-sm">
            <span className="text-slate-800">{t(row.key)}</span>
            <span className={row.up ? 'text-emerald-700' : 'text-amber-700'}>{row.up ? t('up') : t('down')}</span>
          </li>
        ))}
      </ul>
    </SiteFrame>
  );
}
