/**
 * Engagement prediction, the server side: the Page's last
 * year of posts from what the sync stored, compared with the draft.
 */
import { formatInZone } from './time';
import { loadPagePosts } from './page-analysis-data';
import { predictEngagement, type Draft, type Prediction } from './engagement-prediction';

const YEAR_MS = 365 * 86_400_000;

export async function engagementOutlook(input: { targetId: string; draft: Draft; timeZone: string; now?: Date }): Promise<Prediction> {
  const now = input.now ?? new Date();
  const posts = await loadPagePosts(input.targetId, new Date(now.getTime() - YEAR_MS), now);
  const history = posts.map((post) => ({
    format: post.format,
    length: post.message.length,
    hour: Number(formatInZone(post.publishedAt, input.timeZone, 'H', 'en')),
    weekday: Number(formatInZone(post.publishedAt, input.timeZone, 'i', 'en')) % 7,
    interactions: post.interactions,
  }));
  return predictEngagement(history, input.draft);
}
