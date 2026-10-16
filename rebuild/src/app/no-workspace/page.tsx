import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentRootActor } from '@/server/config/access';
import { AppShell } from '@/components/AppShell';
export const metadata: Metadata = { title: 'No workspace' };
export default async function NoWorkspace() {
  const actor = await currentRootActor();
  if (!actor) redirect('/sign-in');
  if (actor.isInstanceOwner) redirect('/root');
  return <AppShell activeModule="home" enabledModules={[]} enabledFeatures={[]} rootAccess={false} userName={actor.name} workspaceName="No workspace">
    <section className="route-state"><h1>No workspace yet</h1><p>Ask a workspace owner to invite your account. You can sign out from the menu to use another account.</p></section>
  </AppShell>;
}
