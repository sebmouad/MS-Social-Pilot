import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';

import type { AuthContext } from './auth';
import { listPageGroups, visiblePages, type PageGroupView } from './page-groups';
import { targetScope, type PageScope } from './page-access';
import { prisma } from './prisma';
import {
  SELECTION_KEYS,
  SELECTION_NETWORKS,
  networkOfType,
  networksOfPlatform,
  platformOf,
  selectionCookieName,
  selectionQuery,
  typesOfNetwork,
  type SelectionNetwork,
} from './selection';

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
  /** True when Pages or a group were picked (not only a network). */
  picked: boolean;
  /** The network the selection is narrowed to, if any. */
  net: SelectionNetwork | null;
  /** The platform the selection is narrowed to (`meta`, `linkedin`…), if any. */
  platform: string | null;
  /** Networks present among the member's Pages, for the network pills. */
  networks: SelectionNetwork[];
  /** The selection as a query string (`group=…&pages=…&net=…`), for links. */
  query: string;
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

  // No selection in the address: the last one made in this workspace.
  let source = params;
  if (!SELECTION_KEYS.some((key) => first(params[key]))) {
    const saved = (await cookies()).get(selectionCookieName(auth.workspace.id))?.value;
    if (saved) source = Object.fromEntries(new URLSearchParams(decodeURIComponent(saved)));
  }

  const networks = [...new Set(targets.map((target) => networkOfType(target.type)))];
  const netParam = first(source.net) ?? null;
  const net = netParam && (SELECTION_NETWORKS as readonly string[]).includes(netParam) && networks.includes(netParam as SelectionNetwork)
    ? (netParam as SelectionNetwork)
    : null;
  // A platform (Meta: Facebook, Instagram, Threads) narrows to all of its networks.
  const present = targets.map((target) => networkOfType(target.type) as string);
  const platform = net ? platformOf(net) : netParam && present.some((network) => platformOf(network) === netParam) ? netParam : null;
  const netTypes = net ? typesOfNetwork(net) : platform ? networksOfPlatform(platform).flatMap((network) => typesOfNetwork(network as SelectionNetwork)) : null;
  const inNetwork = netTypes ? targets.filter((target) => netTypes.includes(target.type)) : targets;

  const allIds = inNetwork.map((target) => target.id);
  const group = first(source.group) ?? null;
  const picked = visiblePages({ allIds, groups, group, pages: first(source.pages) ?? null });
  // Never empty: a selection that matches nothing any more shows everything.
  const visible = picked && picked.length === 0 ? null : (picked ?? (netTypes ? allIds : null));
  const ids = visible ?? allIds;
  const narrowed = visible !== null;
  const knownGroup = groups.some((entry) => entry.id === group) ? group : null;

  return {
    pages: targets,
    groups,
    group: knownGroup,
    visible,
    ids,
    narrowed,
    picked: picked !== null && picked.length > 0,
    net,
    platform,
    networks,
    query: selectionQuery({ group: knownGroup ?? undefined, pages: first(source.pages), net: net ?? platform ?? undefined }),
    // A limited member is always narrowed to their own Pages, sidebar or not.
    postWhere: narrowed || !auth.pageScope.all ? { targets: { some: { targetId: { in: ids } } } } : {},
  };
}

export interface Selection extends PageFilter {
  /**
   * The member's access narrowed to the selection: drop-in for
   * `auth.pageScope` in any query, so a screen follows the selection by
   * passing this instead.
   */
  scope: PageScope;
}

/** The shared profile selection for a screen (NEXT_PHASES Phase A). */
export async function loadSelection(
  auth: AuthContext,
  params: Record<string, string | string[] | undefined>,
): Promise<Selection> {
  const filter = await loadPageFilter(auth, params);
  return { ...filter, scope: filter.narrowed ? { all: false, ids: filter.ids } : auth.pageScope };
}
