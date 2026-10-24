import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Root-owned bounds for the conversation details panel, quick filters and bulk moderation. */
export const INBOX_DETAILS_CONFIG = [
  entry({ key: 'inbox.relatedPostsLimit', group: 'Inbox · Details', label: 'Related posts shown', kind: 'number', description: 'Maximum posts listed in the conversation details panel for one person.', defaultValue: 10, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'inbox.sentimentTrendLimit', group: 'Inbox · Details', label: 'Sentiment trend points', kind: 'number', description: 'Most recent comments from one person used for the sentiment trend in the details panel.', defaultValue: 12, schema: z.number().int().min(2).max(100), consumption: 'active' }),
  entry({ key: 'inbox.mentionPrefix', group: 'Inbox · Details', label: 'Mention marker', kind: 'text', description: 'Text placed before the channel name to recognise a mention in the Mentions quick filter (for example @ followed by the channel name).', defaultValue: '@', schema: z.string().min(1).max(5), consumption: 'active' }),
  entry({ key: 'inbox.bulkMaxItems', group: 'Inbox · Bulk actions', label: 'Bulk moderation item limit', kind: 'number', description: 'Maximum conversations or comments one bulk resolve, hide or delete request may include in the app, HTTP or MCP.', defaultValue: 25, schema: z.number().int().min(1).max(200), consumption: 'active' }),
] as const;
