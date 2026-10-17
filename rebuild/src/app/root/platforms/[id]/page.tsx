import { notFound } from 'next/navigation';
import { requireRootPage } from '@/server/config/access';
import { RootModuleSettings } from '@/server/root/RootModuleSettings';
import { RootPlatformPublicationEvidence } from '@/server/root/RootPlatformPublicationEvidence';
import { platformModule } from '@/platforms';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `${platformModule(id)?.name ?? 'Platform'} · Root` };
}
export default async function RootPlatformModulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ operationId?: string | string[] }> }) {
  await requireRootPage();
  const queryPromise: Promise<{ operationId?: string | string[] }> = searchParams ?? Promise.resolve({});
  const [{ id }, query] = await Promise.all([params, queryPromise]);
  const module = platformModule(id);
  if (!module) notFound();
  const declared = Object.entries(module.capabilities).filter(([, state]) => state === 'supported');
  return <RootModuleSettings kind="platform" id={module.id} title={module.name} description={module.description} groupPrefix={module.settingsGroup}>
    <section className="root-control__panel"><h2>Declared operations</h2><p>These declarations describe the installed adapter interface. Configuration is not a live provider health check; complete operation coverage and remote verification remain required.</p>
      <ul>{declared.map(([capability]) => <li key={capability}>{capability.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())}</li>)}</ul>
    </section>
    <RootPlatformPublicationEvidence providerId={module.id} operationId={query.operationId} />
  </RootModuleSettings>;
}
