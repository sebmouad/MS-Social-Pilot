import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { MODULES, PAGES } from '@/lib/product';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, canUseModule, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature, canAccessModule } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';

export type CommandActor = { userId: string; workspaceId: string };
export type CommandItem = { id: string; title: string; href: string; module: string; moduleTitle: string };

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
