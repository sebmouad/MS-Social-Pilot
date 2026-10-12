/**
 * Meta permission names, said in plain words.
 *
 * Agencies and their clients are shown what a connection can do ("Can
 * publish"), never the scope names Meta uses (`pages_manage_posts`); those
 * belong to root's configuration. A plain module so client components can
 * read it.
 */
export const ABILITIES = ['pages', 'publish', 'stats', 'comments', 'messages', 'instagram', 'instagramPublish', 'ads'] as const;

export type Ability = (typeof ABILITIES)[number];

/** Every scope an ability needs. */
const NEEDS: Record<Ability, string[]> = {
  pages: ['pages_show_list'],
  publish: ['pages_manage_posts'],
  stats: ['read_insights', 'pages_read_engagement'],
  comments: ['pages_manage_engagement', 'pages_read_user_content'],
  messages: ['pages_messaging'],
  instagram: ['instagram_basic', 'instagram_manage_insights'],
  instagramPublish: ['instagram_content_publish'],
  ads: ['ads_read'],
};

/**
 * What a connection can do, against what the installation asks for.
 *
 * Only abilities the installation requests are listed: a missing one is
 * something reconnecting fixes, and one nobody asked for is not worth a line.
 */
export function abilitiesOf(granted: string[], requested: string[]): Array<{ ability: Ability; granted: boolean }> {
  const has = new Set(granted);
  const asked = new Set(requested);
  return ABILITIES.filter((ability) => NEEDS[ability].some((scope) => asked.has(scope))).map((ability) => ({
    ability,
    granted: NEEDS[ability].filter((scope) => asked.has(scope)).every((scope) => has.has(scope)),
  }));
}
