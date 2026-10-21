import { z } from 'zod';

const itemId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const BULK_ACTIONS = ['resolve', 'reopen', 'hide', 'unhide', 'delete'] as const;
export type BulkAction = typeof BULK_ACTIONS[number];
/** Only comments can be hidden or deleted; every kind can be resolved or reopened. */
export const BULK_COMMENT_ONLY: readonly BulkAction[] = ['hide', 'unhide', 'delete'];
/** The inverse that makes an action undoable; deletion is not reversible. */
export const BULK_INVERSE: Record<BulkAction, BulkAction | null> = { resolve: 'reopen', reopen: 'resolve', hide: 'unhide', unhide: 'hide', delete: null };

export const bulkItemSchema = z.object({ kind: z.enum(['message', 'comment', 'review']), id: itemId }).strict();
export const bulkActionSchema = z.object({ action: z.enum(BULK_ACTIONS), items: z.array(bulkItemSchema).min(1), confirmation: z.string().max(240) }).strict();
export type BulkInboxInput = z.infer<typeof bulkActionSchema>;

/** One exact string covers the whole request, so a stale or edited selection cannot be confirmed by accident. */
export const bulkConfirmation = (action: BulkAction, count: number) => `BULK ${action.toUpperCase()} ${count} INBOX ITEMS`;

export type BulkItemResult =
  | { kind: 'message' | 'comment' | 'review'; id: string; ok: true; state?: string }
  | { kind: 'message' | 'comment' | 'review'; id: string; ok: false; code: string; error: string };
export type BulkInboxResult = { ok: true; action: BulkAction; requested: number; succeeded: number; failed: number; results: BulkItemResult[] };
