import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentRootActor } from '@/server/config/access';
import { AppShell } from '@/components/AppShell';
import { authCopy } from '@/modules/home/auth/copy';
import { authLocale } from '@/modules/home/auth/locale';
export const metadata: Metadata = { title: 'No workspace' };
export default async function NoWorkspace() {
  const actor = await currentRootActor();
  if (!actor) redirect('/sign-in');
  if (actor.isInstanceOwner) redirect('/root');
  const t = authCopy(await authLocale()).noWorkspace;
  return <AppShell activeModule="home" enabledModules={[]} enabledFeatures={[]} rootAccess={false} userName={actor.name} workspaceName={t.label}>
    <section className="route-state"><h1>{t.title}</h1><p>{t.body}</p></section>
  </AppShell>;
}
