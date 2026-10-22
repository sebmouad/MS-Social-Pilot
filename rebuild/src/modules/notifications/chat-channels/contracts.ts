import { z } from 'zod';

export const CHAT_EVENTS = ['publishFailure', 'inboxAlert', 'operatorIncident', 'connectionExpired', 'approvalRequest', 'approvalDecision', 'reviewDecision'] as const;
export type ChatEvent = typeof CHAT_EVENTS[number];
export type ChatActor = { userId: string; workspaceId: string; allowedChannelIds?: readonly string[] };
const text = z.string().trim().min(1);
const events = z.array(z.enum(CHAT_EVENTS)).min(1).refine(values => new Set(values).size === values.length);
export const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slack'), name: text, url: text, events, confirmation: z.string() }).strict(),
  z.object({ kind: z.literal('telegram'), name: text, botToken: text, chatId: text, events, confirmation: z.string() }).strict(),
]);
export const updateSchema = z.object({ id: text, enabled: z.boolean().optional(), events: events.optional(), confirmation: z.string() }).strict().refine(value => value.enabled !== undefined || value.events !== undefined);
export const actionSchema = z.object({ id: text, confirmation: z.string() }).strict();
export const chatConfirmation = {
  create: (name: string) => `CREATE CHAT CHANNEL ${name}`,
  update: (id: string) => `UPDATE CHAT CHANNEL ${id}`,
  delete: (id: string) => `DELETE CHAT CHANNEL ${id}`,
  test: (id: string) => `TEST CHAT CHANNEL ${id}`,
};
export type ChatRow = { id: string; kind: string; name: string; events: string[]; enabled: boolean; lastSentAt: Date | null; hasError: boolean };
export type ChatView = Omit<ChatRow, 'lastSentAt'> & { lastSentAt: string | null };
