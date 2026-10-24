import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const FIRST_COMMENT_CONFIG = [
  entry({ key: 'publishing.maxFirstCommentDelayMinutes', group: 'Publishing · First comments', label: 'Maximum first-comment delay (minutes)', kind: 'number', description: 'Largest delay after confirmed destination publication accepted for a requested first comment. Zero means immediate. Existing records beyond the current limit remain held for review.', defaultValue: 10080, schema: z.number().int().min(0).max(525600), consumption: 'active' }),
  entry({ key: 'publishing.firstCommentCursor', group: 'Publishing · First comments', label: 'Automatic first-comment cursor', kind: 'text', description: 'Ordered scan progress for due requested first comments. Resetting this position does not clear an attempted or uncertain comment and cannot authorize a resend.', defaultValue: '', schema: z.string().max(4096), consumption: 'active' }),
];
