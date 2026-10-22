import { z } from 'zod';

export const inboxItemSchema = z.object({ kind: z.enum(['message', 'comment']), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) }).strict();
export const confirmation = {
  assign: (kind: string, id: string, assigneeId: string | null) => `ASSIGN INBOX ${kind} ${id} TO ${assigneeId ?? 'UNASSIGNED'}`,
  addNote: (kind: string, id: string) => `ADD PRIVATE NOTE ${kind} ${id}`,
  deleteNote: (id: string) => `DELETE PRIVATE NOTE ${id}`,
  createReply: (name: string) => `CREATE SAVED REPLY ${name}`,
  updateReply: (id: string) => `UPDATE SAVED REPLY ${id}`,
  deleteReply: (id: string) => `DELETE SAVED REPLY ${id}`,
};

export const productivityActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), ...inboxItemSchema.shape, assigneeId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).nullable(), confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('note.add'), ...inboxItemSchema.shape, body: z.string().trim().min(1).max(10000), mentionIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)).max(100).optional(), confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('note.delete'), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('reply.create'), name: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(10000), confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('reply.update'), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), name: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(10000), confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('reply.delete'), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), confirmation: z.string().max(500) }).strict(),
]);
export type ProductivityAction = z.infer<typeof productivityActionSchema>;
