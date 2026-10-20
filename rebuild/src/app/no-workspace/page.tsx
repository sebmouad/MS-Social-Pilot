import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentRootActor } from '@/server/config/access';
import { IconUsersGroup } from '@tabler/icons-react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { authCopy } from '@/modules/home/auth/copy';
import { authLocale } from '@/modules/home/auth/locale';
export const metadata: Metadata = { title: 'No workspace' };
export default async function NoWorkspace() {
  const actor = await currentRootActor();
  if (!actor) redirect('/sign-in');
  if (actor.isInstanceOwner) redirect('/root');
  const t = authCopy(await authLocale()).noWorkspace;
  return <AppShell activeModule="home" enabledModules={[]} enabledFeatures={[]} rootAccess={false} userName={actor.name} workspaceName={t.label}>
    <PageHeader title={t.title} module="home" />
    <EmptyState icon={<IconUsersGroup size={22} />} title={t.body} />
  </AppShell>;
}
