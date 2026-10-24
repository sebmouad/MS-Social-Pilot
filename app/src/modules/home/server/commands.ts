import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { withChannelScope } from '@/lib/channel-scope';
import type { ConnectionState } from '@/lib/connection-status';
import { MODULES, PAGES } from '@/lib/product';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, canUseModule, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature, canAccessModule } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { shellChannels } from '@/modules/shell/server/channels';

export type CommandActor = { userId: string; workspaceId: string };
export type CommandItem = { id: string; title: string; href: string; module: string; moduleTitle: string };
/** A creation shortcut: the same module primary actions as the sidebar Create button. */
export type CommandAction = { id: string; title: string; href: string };
/** A channel jump: opens the Inbox scoped to that channel through the shared scope parameter. */
export type CommandChannel = { id: string; title: string; href: string; health: ConnectionState };
/** Channels listed by one palette search; the page limit stays on `home.commandPaletteLimit`. */
const CHANNEL_LIMIT = 50;

const querySchema = z.object({ q: z.string().trim().max(200).optional() }).strict();

/**
 * The pages one member may open, in sidebar order: same modules, same access check as the sidebar, plus
 * sub-pages flagged `palette` (Insights goals, pins and notes) that tabs hide but the palette reaches. Titles always
 * match the sidebar exactly, so the palette never shows a name the sidebar hides.
 */
export async function listNavigationCommands(actor: CommandActor, input: unknown = {}): Promise<{ items: CommandItem[] }> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose a valid search.');
  const [entitlements, permissions, limitRaw] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
    runtimeConfig('home.commandPaletteLimit'),
  ]);
  const limit = z.number().int().min(5).max(100).safeParse(limitRaw);
  if (!limit.success) throw new OperationError('unavailable', 'The command palette is temporarily unavailable.');
  if (!entitlements || !permissions) throw new OperationError('unauthorized', 'Sign in to an authorized workspace.');
  const enabledModules = new Set(MODULES.filter(module => canUseModule(entitlements, module.id as Parameters<typeof canUseModule>[1]) && (module.id === 'home' || canAccessModule(permissions, module.id as Parameters<typeof canAccessModule>[1]))).map(module => module.id));
  const enabledFeatures = new Set(PAGES.filter(page => canUseFeature(entitlements, page.id) && canAccessFeature(permissions, page.id)).map(page => page.id));
  const modules = new Map(MODULES.map(module => [module.id, module.title]));
  const query = parsed.data.q?.toLowerCase() ?? '';
  const items: CommandItem[] = [];
  for (const page of PAGES) {
    if ((page.navigation === false && page.palette !== true) || !enabledModules.has(page.module) || !enabledFeatures.has(page.id)) continue;
    const title = page.title, moduleTitle = modules.get(page.module) ?? page.module;
    if (query && !`${title} ${moduleTitle} ${page.id}`.toLowerCase().includes(query)) continue;
    items.push({ id: page.id, title, href: page.href, module: page.module, moduleTitle });
    if (items.length >= limit.data) break;
  }
  return { items };
}

/**
 * Everything the command bar searches: creation shortcuts, openable pages and
 * channel jumps. Actions mirror the sidebar Create button (same feature and
 * write checks); channels mirror the sidebar scope list (same visibility,
 * member channel limit and health). A failed channel lookup only hides that
 * section; it never blocks the palette.
 */
export async function listPaletteTargets(actor: CommandActor, input: unknown = {}): Promise<{ items: CommandItem[]; actions: CommandAction[]; channels: CommandChannel[] }> {
  const { items } = await listNavigationCommands(actor, input);
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || !permissions) throw new OperationError('unauthorized', 'Sign in to an authorized workspace.');
  const parsed = querySchema.safeParse(input);
  const match = parsed.success && parsed.data.q ? parsed.data.q.toLowerCase() : '';
  const actions: CommandAction[] = [];
  for (const module of MODULES) {
    const action = module.primaryAction;
    if (!action || !canUseModule(entitlements, module.id as Parameters<typeof canUseModule>[1])) continue;
    if (!canUseFeature(entitlements, action.featureId) || !canAccessFeature(permissions, action.featureId) || !canAccessFeature(permissions, action.featureId, 'write')) continue;
    if (!canAccessModule(permissions, module.id as Parameters<typeof canAccessModule>[1])) continue;
    if (match && !`${action.label} create-${module.id}`.toLowerCase().includes(match)) continue;
    actions.push({ id: `create-${module.id}`, title: action.label, href: action.href });
  }
  const scopeIds = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const channels = await shellChannels(actor.workspaceId, scopeIds, CHANNEL_LIMIT).catch(() => []);
  return {
    items,
    actions,
    channels: channels
      .filter(channel => !match || `${channel.name} ${channel.id}`.toLowerCase().includes(match))
      .map(channel => ({ id: channel.id, title: channel.name, href: withChannelScope('/inbox', [channel.id]), health: channel.health })),
  };
}
