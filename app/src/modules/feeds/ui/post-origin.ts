import type { PostOriginProvider } from '@/modules/publishing/ui/origins/post-origin';
import { hasRecipeSource, selectOriginsByPostIds } from '../server/wordpress-store';
import { originText } from './origin-copy';

/** Answers "was this post made by recipe automation?" from the plan ledger; Publishing reaches it only through the installed list. */
export const recipePostOrigin: PostOriginProvider = {
  kind: 'recipe',
  label: locale => originText(locale, 'badge'),
  filterLabel: locale => originText(locale, 'filter'),
  linkLabel: locale => originText(locale, 'link'),
  available: workspaceId => hasRecipeSource(workspaceId),
  async lookup(workspaceId, postIds) {
    const rows = await selectOriginsByPostIds(workspaceId, postIds);
    return new Map(rows.map(row => [row.postId, { sourceName: row.sourceName, url: row.permalink }]));
  },
};
