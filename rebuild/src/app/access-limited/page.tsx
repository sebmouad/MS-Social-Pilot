import { AppShell } from '@/components/AppShell';
import { requireViewer } from '@/server/context';

export default async function AccessLimitedPage() {
  // Authenticate membership without requiring the feature that led here.
  const viewer = await requireViewer({ channelScoped: true });
  return <AppShell activeModule="home" enabledModules={[]} enabledFeatures={[]} rootAccess={viewer.user.isInstanceOwner}
    userName={viewer.user.name} workspaceName={viewer.membership.workspace.name} workspaceId={viewer.workspaceId}
    workspaces={viewer.workspaces.map(item => ({ id: item.workspace.id, name: item.workspace.name }))}>
    <section className="route-state"><h1>Workspace access unavailable</h1><p>This workspace or feature is unavailable with your current access.</p><p>Choose another workspace from the menu, or contact the workspace owner for help.</p></section>
  </AppShell>;
}
