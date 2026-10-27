import { analyticsActorFor, type McpToolGroup } from '@/server/mcp/kit';
import { readPosts } from './service';
import { readContentPerformance } from './performance';
export const postsMcp: McpToolGroup = {
  id: 'analytics-posts',
  tools: [{ name: 'get_content_performance', description: 'What works on these channels: median reach and engagement per 100 people reached, by posting hour and weekday (workspace time zone), channel, connected profile (the account the channels were added through), origin (made in this app or published elsewhere) and caption style (opens with an emoji or words, asks a question, length), with the best and weakest posts. Stored measures only. Give compareStart/compareEnd (YYYY-MM-DD) to get the totals of an earlier period, for example before a change of posting times or writing voice. To act on it: change the writing voice (update_workspace_operations), posting times (save_recipe_source or the channel queues), or run a caption test.', inputSchema: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, compareStart: { type: 'string' }, compareEnd: { type: 'string' }, filter: { type: 'string', enum: ['1'] }, channel: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } }, { name: 'get_analytics_posts', description: 'Read a page of published posts and stored measures. Unknown measures remain null. Continue with nextPage. To find what works, sort by engagement (reactions + comments + shares) or a returned measure key (reach, impressions, post_media_view, clicks…) with direction desc; publishedAt is the default. filter "1" with channel limits to selected channels.', inputSchema: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, filter: { type: 'string', enum: ['1'] }, channel: { type: 'array', items: { type: 'string' } }, page: { type: 'integer', minimum: 1 }, sort: { type: 'string', description: 'publishedAt (default), engagement, or a measure key returned in measures, e.g. reach or post_media_view.' }, direction: { type: 'string', enum: ['asc', 'desc'] } }, additionalProperties: false } }],
  features: { get_analytics_posts: 'analytics/posts', get_content_performance: 'analytics/posts' },
  scope: { resourceTools: ['get_analytics_posts', 'get_content_performance'] },
  execute: async (viewer, name, args, cap) => {
    if (name === 'get_content_performance') return readContentPerformance(analyticsActorFor(viewer, cap), args);
    const data = await readPosts(analyticsActorFor(viewer, cap), args, cap);
    return { period: data.period, items: data.items, measures: data.measures, page: data.input.page, nextPage: data.nextPage };
  },
};
