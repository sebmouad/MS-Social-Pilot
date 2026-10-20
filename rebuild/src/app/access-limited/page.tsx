import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { authCopy } from '@/modules/home/auth/copy';
import { authLocale } from '@/modules/home/auth/locale';
import { requireViewer } from '@/server/context';

export const metadata: Metadata = { title: 'Access unavailable' };

export default async function AccessLimitedPage() {
  // Authenticate membership without requiring the feature that led here.
  const viewer = await requireViewer({ channelScoped: true });
  const t = authCopy(await authLocale()).accessLimited;
  return <AppShell activeModule="home" enabledModules={[]} enabledFeatures={[]} rootAccess={viewer.user.isInstanceOwner}
    userName={viewer.user.name} workspaceName={viewer.membership.workspace.name} workspaceId={viewer.workspaceId}
    workspaces={viewer.workspaces.map(item => ({ id: item.workspace.id, name: item.workspace.name }))}>
    <section className="route-state"><h1>{t.title}</h1><p>{t.body}</p><p>{t.help}</p></section>
  </AppShell>;
}
