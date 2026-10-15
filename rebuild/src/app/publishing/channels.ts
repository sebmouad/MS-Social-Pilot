import { getTargets } from '@/server/data';
import { hasPlatformCapability } from '@/server/entitlements';
import { platformFor } from '@/server/platforms/registry';
import { PLATFORM_MODULES, platformModule } from '@/platforms';
import type { PlatformModule } from '@/platforms/module';
import type { ComposeModule } from '@/lib/publishing/compose-rules';
import type { requireViewer } from '@/server/context';

type Viewer = Awaited<ReturnType<typeof requireViewer>>;

export type ChannelChoice = {
  id: string;
  name: string;
  type: string;
  /** Label of the channel kind from its platform module, e.g. "Facebook Page". */
  kindLabel: string;
  provider: string | null;
  pictureUrl: string | null;
  canPublish: boolean;
};

/** Channels in the viewer's scope, with whether each can be published to right now. */
export async function loadChannelChoices(viewer: Viewer): Promise<ChannelChoice[]> {
  const allowed = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const targets = (await getTargets(viewer.workspaceId)).filter(target => allowed === null || allowed.includes(target.id));
  return Promise.all(targets.map(async target => {
    const provider = target.socialAccount?.provider ?? null;
    const adapter = provider && hasPlatformCapability(viewer.entitlements, provider) ? await platformFor(provider, 'publishing') : null;
    const module = provider ? platformModule(provider) : undefined;
    return {
      id: target.id, name: target.name, type: target.type, provider, pictureUrl: target.pictureUrl ?? target.socialAccount?.pictureUrl ?? null,
      kindLabel: module?.channelKinds.find(kind => kind.kind === target.type)?.label ?? module?.name ?? 'Channel',
      canPublish: Boolean(target.canPublish && !target.socialAccount?.invalidatedAt && adapter?.publish && adapter.supportsTargetKind?.(target.type, 'publishing')),
    };
  }));
}

/** Names, badges and post rules of installed platform modules, for client components. */
export function composeModules(providers?: readonly string[]): ComposeModule[] {
  return (PLATFORM_MODULES as readonly PlatformModule[])
    .filter(module => module.publishing && (!providers || providers.includes(module.id)))
    .map(module => ({ id: module.id, name: module.name, mark: { ...module.mark }, traits: { ...module.publishing! } }));
}

/** Platform name and badge by provider ID, for lists that show where a post goes. */
export function moduleLabels(): Record<string, { name: string; mark: { text: string; color: string } }> {
  return Object.fromEntries((PLATFORM_MODULES as readonly PlatformModule[]).map(module => [module.id, { name: module.name, mark: { ...module.mark } }]));
}
