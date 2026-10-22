import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { AppShell } from '@/components';
import type { ModuleId } from '@/lib/product';
import { requireViewer } from './context';
import { canUseFeature, canUseModule } from './entitlements';
import { canAccessFeature, canAccessModule } from './permissions';
import { configValueOrDefault } from './config/config-or-default';
import { COMMAND_COPY, commandCopySchema } from '@/modules/home/command-copy';

export async function PageFrame({ module, children, sidebar, sidebarWhen, scopedAccess = false }: { module: ModuleId; children: ReactNode; sidebar?: ReactNode; sidebarWhen?: readonly string[]; scopedAccess?: boolean }) {
  const viewer = await requireViewer({ module, channelScoped: scopedAccess });
  const enabledModules = (Object.keys(viewer.entitlements.modules) as ModuleId[]).filter(id => canUseModule(viewer.entitlements, id) && (id === 'home' || canAccessModule(viewer.permissions, id)));
  const enabledFeatures = Object.keys(viewer.entitlements.features).filter(id => canUseFeature(viewer.entitlements, id) && canAccessFeature(viewer.permissions, id));
  const writableFeatures = enabledFeatures.filter(id => canAccessFeature(viewer.permissions, id, 'write'));
  const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const raw = await configValueOrDefault('home.commandPaletteCopy').catch(() => COMMAND_COPY);
  const parsed = commandCopySchema.safeParse(raw);
  const paletteCopy = (parsed.success ? parsed.data : COMMAND_COPY)[locale];
  return <AppShell activeModule={module} enabledModules={enabledModules} enabledFeatures={enabledFeatures} writableFeatures={writableFeatures} rootAccess={viewer.user.isInstanceOwner} userName={viewer.user.name} workspaceName={viewer.membership.workspace.name} workspaceId={viewer.workspaceId} workspaces={viewer.workspaces.map(item => ({ id: item.workspace.id, name: item.workspace.name }))} sidebar={sidebar} sidebarWhen={sidebarWhen} paletteCopy={paletteCopy}>{children}</AppShell>;
}
