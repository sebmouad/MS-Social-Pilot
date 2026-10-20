import { Breadcrumbs } from '@/components/Breadcrumbs';
import { PageHeader } from '@/components/PageHeader';
import { notFound } from 'next/navigation';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { getRootError } from '@/server/root/legacy/errors';
import { ResolveError } from '../ResolveError';
import '../../plans/legacy-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Error · Root' };

export default async function RootErrorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRootPage();
  const { id } = await params;
  let item: Awaited<ReturnType<typeof getRootError>>;
  try { item = await getRootError(actor.id, id); } catch (error) {
    if (error instanceof OperationError && (error.code === 'not_found' || error.code === 'invalid_request')) notFound();
    return <RootFrame active="/root/errors"><section className="root-control__notice" role="alert"><h2>Error unavailable</h2><p>The error could not be loaded.</p><a href="/root/errors">Back to errors</a></section></RootFrame>;
  }
  return <RootFrame active="/root/errors"><div className="root-ops">
    <PageHeader module="root" breadcrumbs={<Breadcrumbs items={[{ label: 'Errors', href: '/root/errors' }, { label: item.source }]} />} title={item.name ?? item.source} description={<>{item.message}</>} />
    <section className="root-ops__panel"><dl>
      <dt>Occurrences</dt><dd>{item.count}</dd><dt>First seen</dt><dd>{new Date(item.firstSeenAt).toLocaleString()}</dd><dt>Last seen</dt><dd>{new Date(item.lastSeenAt).toLocaleString()}</dd>
      <dt>Release</dt><dd>{item.release}</dd>{item.location && <><dt>Location</dt><dd>{item.location}</dd></>}<dt>Status</dt><dd>{item.resolvedAt ? 'Resolved' : 'Open'}</dd>
    </dl><ResolveError id={item.id} resolved={Boolean(item.resolvedAt)} /></section>
    <section className="root-ops__panel"><h2>Stack</h2>{item.stack ? <pre className="root-ops__stack" tabIndex={0}>{item.stack}</pre> : <p className="root-ops__muted">No stack was recorded.</p>}</section>
  </div></RootFrame>;
}
