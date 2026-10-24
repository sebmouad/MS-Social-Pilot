import { recipePostOrigin } from '@/modules/feeds/ui/post-origin';
import { autopilotPostOrigin } from '@/modules/studio/agents/ui/post-origin';
import type { PostOriginProvider } from './post-origin';

/** Explicit installed-feature registration, like the module aggregators: Publishing code below this line stays neutral. */
export const installedPostOrigins: readonly PostOriginProvider[] = [recipePostOrigin, autopilotPostOrigin];
