import { notFound } from 'next/navigation';
import { requireRootPage } from '@/server/config/access';
import { RootModuleSettings } from '@/server/root/RootModuleSettings';
import { RootInboxDeletions } from '@/server/root/RootInboxDeletions';
import { moduleManifests } from '@/modules';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `${moduleManifests.find(module => module.id === id)?.title ?? 'Module'} · Root` };
}
export default async function RootProductModulePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRootPage();
  const { id } = await params;
  const module = moduleManifests.find(item => item.id === id);
  if (!module) notFound();
  return <RootModuleSettings kind="product" id={module.id} title={module.title} description={`Installation controls for ${module.title}. Availability is an installation limit; workspace access and implemented platform operations still determine what customers can use.`}>
    {module.id === 'inbox' ? await RootInboxDeletions() : null}
  </RootModuleSettings>;
}
