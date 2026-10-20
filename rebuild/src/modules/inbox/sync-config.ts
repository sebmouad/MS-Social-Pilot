import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Root-owned discovery bounds consumed by the Inbox sync (src/modules/inbox/server/sync-bounds.ts), passed to each channel module's reads. */
export const INBOX_SYNC_CONFIG = [
  entry({ key: 'inbox.syncConversationPages', group: 'Inbox · Sync discovery', label: 'Conversation pages read per channel', kind: 'number', description: 'Most response pages of conversations one sync reads per channel, newest activity first. Older conversations beyond this are left for a later sync and reported as incomplete.', defaultValue: 10, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'inbox.syncMessagePages', group: 'Inbox · Sync discovery', label: 'Message pages read per conversation', kind: 'number', description: 'Most extra response pages of messages one sync reads in a busy conversation, so new visitor messages are not lost behind the first page. 0 reads only the first page.', defaultValue: 3, schema: z.number().int().min(0).max(50), consumption: 'active' }),
  entry({ key: 'inbox.syncReplyExpansions', group: 'Inbox · Sync discovery', label: 'Reply threads expanded per post', kind: 'number', description: 'Most comments per post whose replies one sync reads directly when the platform listing shows fewer replies than it counts, so visitor replies to replies are found. 0 disables the extra reads.', defaultValue: 25, schema: z.number().int().min(0).max(500), consumption: 'active' }),
] as const;
