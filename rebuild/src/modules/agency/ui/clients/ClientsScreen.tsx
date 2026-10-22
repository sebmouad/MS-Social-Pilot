import { loadCustomerCopy } from '../../server/copy';
import { headers } from 'next/headers';
import { uiCopy, type CustomerCopy, uiLocale } from '../copy';
import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { agencySearchLimit, listAgencyClients } from '@/modules/agency/server/agency';
import { ClientFilters } from '@/modules/agency/ui/AgencyFilters';
import { AgencyHeading, AgencyShell, formatDate } from '@/modules/agency/ui/AgencyChrome';
import { WorkspaceAction } from '@/modules/agency/ui/WorkspaceAction';
import { DataTable, Badge, EmptyState } from '@/components';
import { IconUsersGroup } from '@tabler/icons-react';
import { pageChannelScope } from '@/modules/shell/server/scope';
import styles from '@/modules/agency/ui/agency.module.css';

export default async function AgencyClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ channelScoped: true });
  const locale = uiLocale((await headers()).get('accept-language'));
  const copy = await loadCustomerCopy();
  const t = uiCopy(locale, copy);
  const params = await searchParams;
  if (Object.entries(params).some(([key, value]) => (key !== 'q' && key !== 'channel') || typeof value !== 'string')) {
    return <AgencyShell><AgencyHeading title={t("Clients")} locale={locale} copy={copy} description={t("Review your filters.")} /><RouteNotice error focusKey="agency-filter-error">{t("Choose valid filters and try again.")}</RouteNotice><a href="/agency/clients">{t("Reset filters")}</a></AgencyShell>;
  }
  const q = String(params.q ?? '');
  // Person-wide like the overview: the channel parameter is validated centrally and clarified, never applied.
  const scope = typeof params.channel === 'string' && params.channel ? await pageChannelScope(viewer, params).catch(() => null) : null;
  try {
    const searchLimit = await agencySearchLimit();
    const result = await listAgencyClients({ userId: viewer.user.id }, q ? { q } : {});
    return <AgencyShell>
      <AgencyHeading title={t("Clients")} locale={locale} copy={copy} description={t("Client accounts and pending client invitations in workspaces you own or administer.")} filters={<ClientFilters key={q} locale={locale} copy={copy} q={q} searchLimit={searchLimit} />} />
      {scope && <RouteNotice focusKey="agency-scope-notice">{t("Agency compares every workspace you manage; the channel scope does not filter it.")}</RouteNotice>}
      {result.truncated && <RouteNotice focusKey="agency-truncated">
        {result.filtered ? t("More than {0} workspaces match this search; only the first {1} by name are shown. Search for more of the name to narrow them.", result.limit, result.limit)
          : t("You manage more than {0} workspaces; only the first {1} by name are shown. Search by workspace name to find another.", result.limit, result.limit)}
      </RouteNotice>}
      {result.filtered && result.workspaces.length > 0 && <p className={styles.help}>{t("Search matches workspace names only. All client accounts and pending invitations are listed for the matching workspaces.")}</p>}
      {result.workspaces.length === 0
        ? <EmptyState title={result.filtered ? t("No workspaces match this search.") : t("You do not own or administer any workspace with Agency access yet.")} icon={<IconUsersGroup />} action={<a href={result.filtered ? '/agency/clients' : '/settings/team'}>{result.filtered ? t("Reset filters") : t("View team")}</a>} />
        : result.workspaces.map(item => <section key={item.workspaceId} className={styles.section} aria-labelledby={`client-${item.workspaceId}`}>
          <div className={styles.sectionHead}>
            <h2 id={`client-${item.workspaceId}`}>{item.workspaceName}</h2>
            {item.state === 'available' && <WorkspaceAction locale={locale} copy={copy} workspaceId={item.workspaceId} workspaceName={item.workspaceName} href="/settings/team" label={t("Manage team")} />}
          </div>
          {item.state !== 'available'
            ? <p className={styles.help}>{item.state === 'suspended' ? t("This workspace is suspended, so its clients are not shown.") : t("Data deletion is in progress for this workspace.")}</p>
            : item.clientCount === null
              ? <p className={styles.help}>{t("Client accounts are not shown because you cannot view this workspace&apos;s team.")}</p>
              : <>
                {item.clients.length === 0 ? <p className={styles.help}>{result.filtered ? t("No client accounts match this search.") : t("No client accounts yet.")}</p> : <>
                  <p className={styles.help}>{item.clientCount > item.clients.length ? t('Showing {0} of {1} client accounts.', item.clients.length, item.clientCount) : t('{0} client accounts.', item.clientCount)}</p>
                  <DataTable caption={item.workspaceName} rows={item.clients} rowKey={client => client.userId} columns={[{ key: 'name', label: t("Client"), render: client => <strong>{client.name}</strong> }, { key: 'email', label: t("Email"), render: client => client.email }]} /></>}
                {item.invitationsAvailable
                  ? item.invitations.length > 0 && <><h3>{t("Pending invitations")}</h3><DataTable caption={t("Pending invitations")} rows={item.invitations} rowKey={invite => invite.id} columns={[{ key: 'email', label: t("Email"), render: invite => invite.email }, { key: 'status', label: t("Status"), render: invite => <Badge tone={invite.status === 'expired' ? 'warning' : 'module'}>{invite.status === 'expired' ? t("Expired") : t("Pending")}</Badge> }, { key: 'expires', label: t("Expires"), render: invite => formatDate(invite.expiresAt, locale) }]} /></>
                  : <p className={styles.help}>{t("Invitations cannot be shown here. Manage them from the workspace team settings.")}</p>}
              </>}
        </section>)}
    </AgencyShell>;
  } catch (error) {
    return <AgencyShell><AgencyHeading title={t("Clients")} locale={locale} copy={copy} description={t("Client accounts across your workspaces.")} /><RouteNotice error focusKey="agency-load-error">{error instanceof OperationError ? t(error.message) : t("Client accounts could not be loaded. Refresh and try again.")}</RouteNotice></AgencyShell>;
  }
}
