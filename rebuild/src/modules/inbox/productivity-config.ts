import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Root-owned limits consumed by Inbox productivity routes and services. */
export const INBOX_PRODUCTIVITY_CONFIG = [
  entry({ key: 'inbox.noteMaxCharacters', group: 'Inbox · Productivity', label: 'Private note character limit', kind: 'number', description: 'Maximum characters in a private Inbox note.', defaultValue: 2000, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'inbox.noteHistoryLimit', group: 'Inbox · Productivity', label: 'Private note history limit', kind: 'number', description: 'Maximum private notes returned for an Inbox item.', defaultValue: 100, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'inbox.savedReplyPageLimit', group: 'Inbox · Productivity', label: 'Saved reply page limit', kind: 'number', description: 'Maximum saved replies returned in one page.', defaultValue: 100, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'inbox.savedReplyNameMaxCharacters', group: 'Inbox · Productivity', label: 'Saved reply name limit', kind: 'number', description: 'Maximum saved reply name length.', defaultValue: 100, schema: z.number().int().min(1).max(500), consumption: 'active' }),
  entry({ key: 'inbox.savedReplyBodyMaxCharacters', group: 'Inbox · Productivity', label: 'Saved reply body limit', kind: 'number', description: 'Maximum saved reply body length.', defaultValue: 2000, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'inbox.savedReplyMaxCount', group: 'Inbox · Productivity', label: 'Saved reply count limit', kind: 'number', description: 'Maximum saved replies a workspace may keep. Creating another is refused until one is removed.', defaultValue: 200, schema: z.number().int().min(1).max(5000), consumption: 'active' }),
  entry({ key: 'inbox.productivityAssigneeLimit', group: 'Inbox · Productivity', label: 'Assignable team limit', kind: 'number', description: 'Maximum active members returned for Inbox assignment.', defaultValue: 500, schema: z.number().int().min(1).max(5000), consumption: 'active' }),
  entry({ key: 'inbox.mentionMaxCount', group: 'Inbox · Productivity', label: 'Note mention limit', kind: 'number', description: 'Maximum teammates one private Inbox note may mention.', defaultValue: 20, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'inbox.mentionSuggestionLimit', group: 'Inbox · Productivity', label: 'Mention suggestion limit', kind: 'number', description: 'Maximum mentionable teammates suggested for an Inbox note.', defaultValue: 20, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'inbox.mentionNotificationsEnabled', group: 'Inbox · Productivity', label: 'Note mention notifications', kind: 'boolean', description: 'Notify mentioned teammates about private Inbox notes. Their own notification preferences still apply.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
] as const;
