import type { Prisma } from '@prisma/client';

import type { AuthContext } from './auth';
import { listPageGroups, visiblePages, type PageGroupView } from './page-groups';
import { targetScope } from './page-access';
import { prisma } from './prisma';

/** A Page as the sidebar draws it. */
export interface SidebarPage {
  id: string;
  name: string;
  pictureUrl: string | null;
  type: string;
  category: string | null;
  enabled: boolean;
}

export interface PageFilter {
  /** Every Page this member may see, for the sidebar. */
  pages: SidebarPage[];
  groups: PageGroupView[];
  /** The group picked in the sidebar, if any. */
  group: string | null;
  /** The Pages left visible; null when nothing is hidden. */
  visible: string[] | null;
  /** What the screen should show: the visible Pages, or all of theirs. */
  ids: string[];
  /** True when the screen is narrowed below the member's own Pages. */
  narrowed: boolean;
  /** `where` for posts that reach at least one of `ids`. */
  postWhere: Prisma.PostWhereInput;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Read the sidebar's `group` and `pages` parameters for a screen.
 *
 * Every screen with the Pages sidebar goes through this, so they narrow the
 * same way and always inside the member's access — the parameters can only
 * take Pages away, never add one.
 */
export async function loadPageFilter(
  auth: AuthContext,
  params: Record<string, string | string[] | undefined>,
  options: { types?: string[] } = {},
): Promise<PageFilter> {
  const [targets, groups] = await Promise.all([
    prisma.target.findMany({
      where: {
        workspaceId: auth.workspace.id,
        ...targetScope(auth.pageScope),
        ...(options.types ? { type: { in: options.types as Prisma.EnumTargetTypeFilter['in'] } } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, pictureUrl: true, type: true, category: true, enabled: true },
    }),
    listPageGroups(auth.workspace.id, auth.pageScope),
  ]);

  const allIds = targets.map((target) => target.id);
  const group = first(params.group) ?? null;
  const visible = visiblePages({ allIds, groups, group, pages: first(params.pages) ?? null });
  const ids = visible ?? allIds;
  const narrowed = visible !== null;

  return {
    pages: targets,
    groups,
    group: groups.some((entry) => entry.id === group) ? group : null,
    visible,
    ids,
    narrowed,
    // A limited member is always narrowed to their own Pages, sidebar or not.
    postWhere: narrowed || !auth.pageScope.all ? { targets: { some: { targetId: { in: ids } } } } : {},
  };
}
