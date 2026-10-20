import { headers } from 'next/headers';
import { IconUsers, IconBuilding, IconAlertTriangle, IconActivity, IconDatabase, IconSend } from '@tabler/icons-react';
import { PageHeader } from '@/components/PageHeader';
import { MetricCard } from '@/components/MetricCard';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { BarChart } from '@/components/charts';
import { requireRootPage } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { getRootOverview } from '@/server/root/read-model';
import { readRootDiagnosticsSummary } from '@/server/root/legacy/backups';
import { loadRootModuleHealth } from '@/server/root/module-health';
import { rootCopyLocale } from '@/server/root/legacy/copy';
import { ROOT_INTERFACE_COPY } from '@/lib/config/root-interface-copy';
import { configCopyText } from '@/lib/config/root-config-copy';
import { RootFrame } from '@/server/root/RootFrame';
import { RootMcpConnection } from '@/components/RootMcpConnection';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Root · Control center' };

export default async function RootOverviewPage() {
  const actor = await requireRootPage();
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const [catalog, data, diagnostics, health] = await Promise.all([
    runtimeConfig('root.interfaceCopy').catch(() => ROOT_INTERFACE_COPY),
    getRootOverview().catch(() => null),
    readRootDiagnosticsSummary(actor.id).catch(() => null),
    loadRootModuleHealth(actor.id, 'shared').catch(() => null),
  ]);
  const copy = catalog[locale];
  const shared = health?.modules.find(module => module.kind === 'shared');
  const statuses = shared ? [...(shared.worker ? [shared.worker.status] : []), ...shared.jobs.flatMap(job => [job.freshness, job.outcome])] : [];
  const jobStatus = statuses.includes('fail') ? 'fail' : !shared?.jobs.length || !statuses.length || statuses.includes('unknown') ? 'unknown' : 'pass';
  return <RootFrame active="/root"><div lang={locale}>
    <PageHeader module="root" title={copy.overviewTitle} description={copy.overviewIntro} />
    <section className="root-control__metric-cards" aria-label={copy.storedCounts}>
      <MetricCard module="root" label={copy.workspaces} value={data?.workspaces} unavailable={data ? undefined : copy.unavailable} icon={<IconBuilding />} hint={<a href="/root/workspaces">{copy.workspaces}</a>} />
      <MetricCard module="root" label={copy.users} value={data?.users} unavailable={data ? undefined : copy.unavailable} icon={<IconUsers />} hint={<a href="/root/users">{copy.users}</a>} />
      <MetricCard module="root" label={copy.errors} value={diagnostics?.errors?.openLast24h} unavailable={diagnostics?.errors ? undefined : copy.unavailable} icon={<IconAlertTriangle />} hint={<a href="/root/errors">{copy.errorsHint}</a>} />
      <MetricCard module="root" label={copy.jobs} value={<Badge tone={jobStatus === 'pass' ? 'success' : jobStatus === 'fail' ? 'danger' : 'warning'} icon={<IconActivity size={16} />}>{copy[jobStatus]}</Badge>} icon={<IconActivity />} hint={<a href="/root/operations">{copy.checkHealth}</a>} />
    </section>
    {!data ? <EmptyState tone="error" title={copy.summaryFailure} icon={<IconDatabase />} action={<a href="/root">{copy.retry}</a>}>{copy.summaryHint}</EmptyState> : <>
      <section className="root-control__panel" aria-label={copy.attention}>
        <h2>{copy.attention}</h2><p>{copy.attentionHint}</p>
        <ul className="root-control__attention-list">
          {data.workspaces === 0 && <li>{copy.noWorkspace} <a href="/root/workspaces">{copy.workspaces}</a></li>}
          {data.sources === 0 && <li>{copy.noSource} <a href="/root/platforms">{copy.platforms}</a></li>}
          {data.failedPosts > 0 && <li>{configCopyText(copy.failedPosts, { count: data.failedPosts })} <a href="/root/activity">{copy.activity}</a></li>}
        </ul>
        {data.workspaces > 0 && data.sources > 0 && data.failedPosts === 0 && <p className="root-control__clear">{copy.clearAttention}</p>}
        <div className="root-control__links"><a href="/root/operations">{copy.jobs}</a><a href="/root/activity">{copy.activity}</a><a href="/root/modules">{copy.modules}</a><a href="/root/platforms">{copy.platforms}</a><a href="/root/config">{copy.config}</a></div>
      </section>
      <section className="root-control__panel">
        <div className="root-control__metric-cards">
          <MetricCard module="root" label={copy.sources} value={data.sources} icon={<IconDatabase />} />
          <MetricCard module="publishing" label={copy.published} value={data.publishedPosts} icon={<IconSend />} />
        </div>
        <BarChart label={copy.countsChart} locale={locale} categories={[copy.sources, copy.published]} series={[{ id: 'counts', name: copy.count, values: [data.sources, data.publishedPosts] }]} orientation="horizontal" />
      </section>
    </>}
    <RootMcpConnection />
  </div></RootFrame>;
}
