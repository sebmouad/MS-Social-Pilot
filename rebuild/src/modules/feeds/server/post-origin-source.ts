import type { PostOriginSource } from '@/modules/publishing/server/origin-source';
import { selectPostIdsWithOrigin } from './wordpress-store';

/** Recipe automation as a post-list filter: posts created from its plan ledger. */
export const recipeOriginSource: PostOriginSource = {
  kind: 'recipe',
  matchingPostIds: workspaceId => selectPostIdsWithOrigin(workspaceId),
};
