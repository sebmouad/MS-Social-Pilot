import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { Icon } from '@/components/Icon';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { rootOverview } from '@/lib/root';
import { readSetupChecks } from '@/lib/setup';
import { missingOperatorDetails, operatorDetails } from '@/lib/operator';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.overview.title');
}

/** The installation at a glance, with what needs root's attention first. */
export default async function RootOverviewPage() {
  await requireRoot();
  const t = await getTranslations('root');
  const format = await getFormatter();
  const [overview, checks, operator] = await Promise.all([rootOverview(), readSetupChecks(), operatorDetails()]);
  const legalGaps = missingOperatorDetails(operator).length;
  const missing = checks.filter((check) => !check.ok && !check.optional).length;

  const tiles = [
    { label: t('overview.workspaces'), value: overview.workspaces, href: '/root/workspaces' },
    { label: t('overview.users'), value: overview.users, href: '/root/users' },
    { label: t('overview.pages'), value: overview.pages, href: '/root/workspaces' },
    { label: t('overview.invitations'), value: overview.pendingInvitations, href: '/root/registration' },
    { label: t('overview.scheduled'), value: overview.scheduled, href: null },
    { label: t('overview.failed'), value: overview.failed, href: null },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('overview.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('overview.subtitle')}</p>
      </header>

      {missing > 0 && (
        <Link href="/setup" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">
          <Icon name="warning" size={16} /> {t('overview.setupMissing', { count: missing })}
        </Link>
      )}

      {legalGaps > 0 && (
        <Link href="/root/config" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">
          <Icon name="warning" size={16} /> {t('overview.operatorMissing', { count: legalGaps })}
        </Link>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => {
          const body = (
            <>
              <p className="text-[13px] font-semibold text-slate-600">{tile.label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{format.number(tile.value)}</p>
            </>
          );
          return tile.href ? (
            <Link key={tile.label} href={tile.href} className="card p-4 hover:shadow-md">
              {body}
            </Link>
          ) : (
            <div key={tile.label} className="card p-4">
              {body}
            </div>
          );
        })}
      </div>
      {overview.disabled > 0 && <p className="text-sm text-slate-600">{t('overview.disabled', { count: overview.disabled })}</p>}
    </div>
  );
}
