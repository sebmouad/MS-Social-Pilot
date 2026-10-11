/**
 * What each network accepts in one post, in a module with no server imports,
 * so the composer can warn while the post is being written and the server can
 * refuse the same things when it is saved.
 */

export type NetworkRuleKey = 'bluesky' | 'mastodon' | 'linkedin' | 'threads' | 'x' | 'pinterest';

export interface NetworkRules {
  label: string;
  /** Characters (graphemes) of text. */
  textLimit: number;
  maxImages: number;
  video: boolean;
  /** Pinterest: a Pin is a picture. */
  needsMedia: boolean;
  /** The network draws a card for a link, so the link need not be in the text. */
  linkCard: boolean;
}

export const NETWORK_RULES: Record<NetworkRuleKey, NetworkRules> = {
  bluesky: { label: 'Bluesky', textLimit: 300, maxImages: 4, video: false, needsMedia: false, linkCard: true },
  mastodon: { label: 'Mastodon', textLimit: 500, maxImages: 4, video: true, needsMedia: false, linkCard: false },
  linkedin: { label: 'LinkedIn', textLimit: 3000, maxImages: 9, video: false, needsMedia: false, linkCard: true },
  threads: { label: 'Threads', textLimit: 500, maxImages: 20, video: true, needsMedia: false, linkCard: true },
  x: { label: 'X', textLimit: 280, maxImages: 4, video: false, needsMedia: false, linkCard: false },
  pinterest: { label: 'Pinterest', textLimit: 500, maxImages: 5, video: false, needsMedia: true, linkCard: true },
};

export function isRuledNetwork(type: string): type is NetworkRuleKey {
  return Object.hasOwn(NETWORK_RULES, type);
}

/** Characters as a person counts them: one emoji is one. */
export function graphemeLength(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

/** X counts every link as 23 characters, whatever its length. */
export function xLength(text: string): number {
  return graphemeLength(text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)));
}

export interface NetworkProblem {
  network: NetworkRuleKey;
  target: string;
  /** Key under `errors` as `network_<key>`. */
  key: 'tooLong' | 'tooManyImages' | 'noVideo' | 'needsImage';
  params: Record<string, string | number>;
}

/** Whether a post fits each network it is going to. */
export function networkProblems(
  targets: Array<{ type: string; name: string }>,
  post: { message: string; link: string | null; media: Array<{ kind: string }> },
): NetworkProblem[] {
  const problems: NetworkProblem[] = [];
  const images = post.media.filter((item) => item.kind === 'image').length;
  const videos = post.media.filter((item) => item.kind === 'video').length;
  for (const target of targets) {
    if (!isRuledNetwork(target.type)) continue;
    const rules = NETWORK_RULES[target.type];
    const withLink =
      post.link && (!rules.linkCard || post.media.length > 0) && !post.message.includes(post.link)
        ? `${post.message}\n\n${post.link}`
        : post.message;
    const length = target.type === 'x' ? xLength(withLink) : graphemeLength(withLink);
    if (length > rules.textLimit) problems.push({ network: target.type, target: target.name, key: 'tooLong', params: { limit: rules.textLimit, length } });
    if (images > rules.maxImages) problems.push({ network: target.type, target: target.name, key: 'tooManyImages', params: { max: rules.maxImages } });
    if (videos > 0 && !rules.video) problems.push({ network: target.type, target: target.name, key: 'noVideo', params: {} });
    if (rules.needsMedia && images === 0) problems.push({ network: target.type, target: target.name, key: 'needsImage', params: {} });
  }
  return problems;
}
