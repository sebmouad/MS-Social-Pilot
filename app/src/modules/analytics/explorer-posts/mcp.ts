import { analyticsActorFor, type McpToolGroup } from '@/server/mcp/kit';
import { readPosts } from './service';
export const postsMcp: McpToolGroup = {
  id: 'analytics-posts',
  tools: [{ name: 'get_analytics_posts', description: 'Read a page of published posts and stored measures. Unknown measures remain null. Continue with nextPage. Sort by publishedAt or a returned measure key.', inputSchema: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, filter: { type: 'string', enum: ['1'] }, channel: { type: 'array', items: { type: 'string' } }, page: { type: 'integer', minimum: 1 }, sort: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } }, additionalProperties: false } }],
  features: { get_analytics_posts: 'analytics/posts' },
  scope: { resourceTools: ['get_analytics_posts'] },
  execute: async (viewer, _name, args, cap) => {
    const data = await readPosts(analyticsActorFor(viewer, cap), args, cap);
    return { period: data.period, items: data.items, measures: data.measures, page: data.input.page, nextPage: data.nextPage };
  },
};
