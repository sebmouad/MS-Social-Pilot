import { ModuleHealth } from '../ModuleHealth';
import { notFound } from 'next/navigation';
import { requireRootPage } from '@/server/config/access';
import { RootModuleSettings } from '@/modules/root/ui/RootModuleSettings';
import { RootInboxDeletions } from '@/modules/root/ui/RootInboxDeletions';
import { RootPostDeletions } from '@/modules/root/ui/RootPostDeletions';
import { RootPublicationAttempts } from '@/modules/root/ui/RootPublicationAttempts';
import { moduleManifests } from '@/modules';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `${moduleManifests.find(module => module.id === id)?.title ?? 'Module'} · Root` };
}
export default async function RootProductModulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ tab?: string | string[] }> }) {
  await requireRootPage();
  const [{ id }, query] = await Promise.all([params, searchParams ?? Promise.resolve({} as { tab?: string | string[] })]);
  const module = moduleManifests.find(item => item.id === id);
  if (!module) notFound();
  return <RootModuleSettings kind="product" id={module.id} tab={typeof query.tab === 'string' ? query.tab : undefined} title={module.title} description={`Installation controls for ${module.title}. Availability is an installation limit; workspace access and implemented platform operations still determine what customers can use.`}>
    {await ModuleHealth({ scope: `product:${module.id}` })}
    {module.id === 'inbox' ? await RootInboxDeletions() : null}
    {module.id === 'publishing' ? <>{await RootPublicationAttempts()}{await RootPostDeletions()}</> : null}
  </RootModuleSettings>;
}
