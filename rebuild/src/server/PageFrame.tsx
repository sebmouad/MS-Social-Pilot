import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { AppShell } from '@/components';
import type { AreaId, ModuleId } from '@/lib/product';
import { parseChannelScope } from '@/lib/channel-scope';
import { requireViewer } from './context';
import { requestLocale } from './platforms/request-locale';
import { canUseFeature, canUseModule } from './entitlements';
import { canAccessFeature, canAccessModule } from './permissions';
import { configValueOrDefault } from './config/config-or-default';
import { COMMAND_COPY, commandCopySchema } from '@/modules/home/command-copy';
import { shellChrome } from '@/modules/shell/server/chrome';
import { shellChannels } from '@/modules/shell/server/channels';
import { workspaceUsesTasks } from '@/modules/tasks/server/usage';
import { loadWorkspaceOperations } from '@/modules/settings/server/workspace-operations';
import { pendingApprovalCount } from '@/modules/publishing/server/approvals-badge';

export async function PageFrame({ module, children, sidebar, sidebarWhen, scopedAccess = false }: { module: ModuleId; children: ReactNode; sidebar?: ReactNode; sidebarWhen?: readonly string[]; scopedAccess?: boolean }) {
  const viewer = await requireViewer({ module, channelScoped: scopedAccess });
  const enabledModules = (Object.keys(viewer.entitlements.modules) as ModuleId[]).filter(id => canUseModule(viewer.entitlements, id) && (id === 'home' || canAccessModule(viewer.permissions, id)));
  const enabledFeatures = Object.keys(viewer.entitlements.features).filter(id => canUseFeature(viewer.entitlements, id) && canAccessFeature(viewer.permissions, id));
  const writableFeatures = enabledFeatures.filter(id => canAccessFeature(viewer.permissions, id, 'write'));
  const { copy, policy, locale } = await shellChrome();
  const raw = await configValueOrDefault('home.commandPaletteCopy').catch(() => COMMAND_COPY);
  const parsed = commandCopySchema.safeParse(raw);
  const paletteCopy = (parsed.success ? parsed.data : COMMAND_COPY)[locale];
  // The channel list scopes every channel-aware page. A failed lookup only hides the list; it never blocks the page.
  const channels = await shellChannels(viewer.workspaceId, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, policy.channelListMax).catch(() => []);
  const jar = await cookies();
  const remembered = parseChannelScope({ cookie: decodeURIComponent(jar.get(`${policy.scopeCookiePrefix}${viewer.workspaceId}`)?.value ?? ''), allowed: channels.map(channel => channel.id) });
  // Tasks and Agency appear only when used; their routes keep working while hidden.
  const optionalAreas: AreaId[] = [];
  // Tasks shows once the workspace has a task, or a manager turned it on in Settings › Workspace.
  const [usesTasks, tasksArea] = await Promise.all([
    enabledFeatures.includes('tasks/board') ? workspaceUsesTasks(viewer.workspaceId).catch(() => false) : false,
    enabledFeatures.includes('tasks/board') ? loadWorkspaceOperations(viewer.workspaceId).then(operations => operations.tasksAreaEnabled, () => false) : false,
  ]);
  if (usesTasks || tasksArea) optionalAreas.push('tasks');
  // Agency compares administered (client) workspaces, so plain memberships never summon it.
  if (viewer.workspaces.filter(entry => entry.role === 'owner' || entry.role === 'admin').length > 1) optionalAreas.push('agency');
  // Pending Approvals show as a badge on the Content tabs.
  const tabCounts: Record<string, number> = {};
  if (module === 'publishing' && enabledFeatures.includes('publishing/approvals')) tabCounts['publishing/approvals'] = await pendingApprovalCount({ userId: viewer.user.id, workspaceId: viewer.workspaceId });
  return <AppShell tabCounts={tabCounts} activeModule={module} enabledModules={enabledModules} enabledFeatures={enabledFeatures} writableFeatures={writableFeatures} rootAccess={viewer.user.isInstanceOwner} userName={viewer.user.name} workspaceName={viewer.membership.workspace.name} workspaceId={viewer.workspaceId} workspaces={viewer.workspaces.map(item => ({ id: item.workspace.id, name: item.workspace.name }))} sidebar={sidebar} sidebarWhen={sidebarWhen} paletteCopy={paletteCopy}
    copy={copy} policy={policy} channels={channels.map(channel => ({ id: channel.id, name: channel.name, pictureUrl: channel.pictureUrl, health: channel.health }))} initialScope={remembered.ids} initialScopeDropped={remembered.dropped} optionalAreas={optionalAreas} initialCollapsed={jar.get(policy.sidebarCookie)?.value === '1'}>{children}</AppShell>;
}
