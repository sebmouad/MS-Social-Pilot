import { loadRootErrorCopy } from '../copy';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { PageHeader } from '@/components/PageHeader';
import { notFound } from 'next/navigation';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { getRootError } from '@/modules/root/server/admin/errors';
import { ResolveError } from '../ResolveError';
import '../../plans/root-ops.css';

export const dynamic = 'force-dynamic';
export async function generateMetadata() { return { title: `${(await loadRootErrorCopy()).copy.detailTitle} · Root` }; }

export default async function RootErrorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRootPage();
  const { copy, locale } = await loadRootErrorCopy();
  const { id } = await params;
  let item: Awaited<ReturnType<typeof getRootError>>;
  try { item = await getRootError(actor.id, id); } catch (error) {
    if (error instanceof OperationError && (error.code === 'not_found' || error.code === 'invalid_request')) notFound();
    return <RootFrame active="/root/errors"><section className="root-control__notice" role="alert"><h2>{copy.detailUnavailable}</h2><p>{copy.detailFailure}</p><a href="/root/errors">{copy.back}</a></section></RootFrame>;
  }
  return <RootFrame active="/root/errors"><div className="root-ops">
    <PageHeader module="root" breadcrumbs={<Breadcrumbs items={[{ label: copy.title, href: '/root/errors' }, { label: item.source }]} />} title={item.name ?? item.source} description={<>{item.message}</>} />
    <section className="root-ops__panel"><dl>
      <dt>{copy.occurrences}</dt><dd>{item.count}</dd><dt>{copy.firstSeen}</dt><dd>{new Date(item.firstSeenAt).toLocaleString(locale)}</dd><dt>{copy.lastSeen}</dt><dd>{new Date(item.lastSeenAt).toLocaleString(locale)}</dd>
      <dt>{copy.release}</dt><dd>{item.release}</dd>{item.location && <><dt>{copy.location}</dt><dd>{item.location}</dd></>}<dt>{copy.status}</dt><dd>{item.resolvedAt ? copy.resolved : copy.open}</dd>
    </dl><ResolveError id={item.id} resolved={Boolean(item.resolvedAt)} copy={copy} /></section>
    <section className="root-ops__panel"><h2>{copy.stack}</h2>{item.stack ? <pre className="root-ops__stack" tabIndex={0}>{item.stack}</pre> : <p className="root-ops__muted">{copy.noStack}</p>}</section>
  </div></RootFrame>;
}
