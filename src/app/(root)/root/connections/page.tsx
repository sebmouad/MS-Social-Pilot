import { getFormatter, getTranslations } from 'next-intl/server';

import { ConnectionHealth } from '@/components/ConnectionHealth';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { NETWORK_LABELS } from '@/lib/networks';
import { prisma } from '@/lib/prisma';
import { connectionStatus, groupByPlatform, type ConnectionStatus } from '@/lib/root-connections';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.connections.title');
}

const STATUS_STYLE: Record<ConnectionStatus, string> = {
  ok: 'bg-emerald-50 text-emerald-800',
  paused: 'bg-slate-100 text-slate-700',
  blocked: 'bg-amber-50 text-amber-800',
  reconnect: 'bg-red-50 text-red-800',
};

/**
 * Every channel of every workspace, grouped by platform, with the technical
 * detail workspace screens no longer show: token expiry, granted scopes, raw
 * errors, provider IDs, and the live connection check. Root only.
 */
export default async function RootConnectionsPage() {
  await requireRoot();
  const t = await getTranslations('root.connections');
  const format = await getFormatter();
  const now = Date.now();

  const targets = await prisma.target.findMany({
    include: {
      workspace: { select: { id: true, name: true } },
      socialAccount: {
        select: {
          name: true,
          provider: true,
          providerUserId: true,
          scopes: true,
          tokenExpiresAt: true,
          invalidatedAt: true,
          invalidReason: true,
        },
      },
    },
  });

  const rows = targets.map((target) => ({
    id: target.id,
    type: target.type as string,
    name: target.name,
    providerId: target.providerId,
    workspaceId: target.workspace.id,
    workspaceName: target.workspace.name,
    account: target.socialAccount,
    ownToken: target.accessToken !== null,
    publishBlocker: target.publishBlocker,
    publishBlockerCode: target.publishBlockerCode,
    status: connectionStatus({
      accountInvalid: target.socialAccount?.invalidatedAt != null,
      orphan: target.socialAccount === null,
      enabled: target.enabled,
      canPublish: target.canPublish,
    }),
  }));
  const groups = groupByPlatform(rows);

  const platformLabel = (platform: string) =>
    platform === 'facebook'
      ? 'Facebook'
      : platform === 'instagram'
        ? 'Instagram'
        : ((NETWORK_LABELS as Record<string, string>)[platform] ?? platform);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      {groups.length > 0 && (
        <nav aria-label={t('jumpTo')} className="flex flex-wrap gap-2">
          {groups.map((group) => (
            <a
              key={group.platform}
              href={`#platform-${group.platform}`}
              className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-surface hover:bg-slate-50"
            >
              {platformLabel(group.platform)} · {group.rows.length}
            </a>
          ))}
        </nav>
      )}

      {groups.length === 0 && <p className="card p-5 text-sm text-slate-600">{t('none')}</p>}

      {groups.map((group) => (
        <section key={group.platform} id={`platform-${group.platform}`} className="card scroll-mt-20 p-0">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">
              {platformLabel(group.platform)}{' '}
              <span className="text-sm font-normal text-slate-500">{t('count', { count: group.rows.length })}</span>
            </h2>
            {group.problems > 0 && (
              <span className="badge bg-red-50 text-red-800">{t('problems', { count: group.problems })}</span>
            )}
          </header>
          <ul className="divide-y divide-slate-100">
            {group.rows.map((row) => (
              <li key={row.id} className="px-4 py-3 sm:px-5">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-slate-900">{row.name}</span>
                      <span className="block truncate text-xs text-slate-500">{row.workspaceName}</span>
                    </span>
                    <span className={`badge ${STATUS_STYLE[row.status]}`}>{t(`status.${row.status}`)}</span>
                  </summary>
                  <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
                    <dt className="text-slate-500">{t('field.type')}</dt>
                    <dd className="text-slate-800">{row.type}</dd>
                    <dt className="text-slate-500">{t('field.providerId')}</dt>
                    <dd className="break-all font-mono text-xs text-slate-800">{row.providerId}</dd>
                    <dt className="text-slate-500">{t('field.account')}</dt>
                    <dd className="text-slate-800">
                      {row.account ? `${row.account.name} (${row.account.providerUserId})` : t('orphan')}
                    </dd>
                    <dt className="text-slate-500">{t('field.token')}</dt>
                    <dd className="text-slate-800">
                      {row.ownToken ? t('ownToken') : t('userToken')}
                      {' · '}
                      {row.account?.tokenExpiresAt
                        ? t('expires', { when: format.relativeTime(row.account.tokenExpiresAt, now) })
                        : t('noExpiry')}
                    </dd>
                    <dt className="text-slate-500">{t('field.scopes')}</dt>
                    <dd className="break-words font-mono text-xs text-slate-800">{row.account?.scopes || '—'}</dd>
                    {row.account?.invalidReason && (
                      <>
                        <dt className="text-slate-500">{t('field.accountError')}</dt>
                        <dd className="break-words text-red-700">{row.account.invalidReason}</dd>
                      </>
                    )}
                    {row.publishBlocker && (
                      <>
                        <dt className="text-slate-500">{t('field.blocker')}</dt>
                        <dd className="break-words text-amber-800">
                          {row.publishBlocker}
                          {row.publishBlockerCode && <code className="ms-1.5 text-xs">{row.publishBlockerCode}</code>}
                        </dd>
                      </>
                    )}
                  </dl>
                  {(group.platform === 'facebook' || group.platform === 'instagram') && row.account && (
                    <div className="mt-3">
                      <ConnectionHealth workspaceId={row.workspaceId} />
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
