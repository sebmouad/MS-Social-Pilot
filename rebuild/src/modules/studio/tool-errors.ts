import { z } from 'zod';

/** Safe customer sentences for every failure a composer tool can return, English and French. Leaf module: no server imports, so the config registry can use it without a cycle. */
export const toolErrorCopySchema = z.object({ invalid_request: z.string().min(1), unauthorized: z.string().min(1), forbidden: z.string().min(1), not_found: z.string().min(1), unavailable: z.string().min(1), reconnect_required: z.string().min(1), conflict: z.string().min(1), upstream_failure: z.string().min(1) });
export type ToolErrorCopy = z.infer<typeof toolErrorCopySchema>;
export type Locale = 'en' | 'fr';
