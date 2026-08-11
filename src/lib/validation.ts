import { z } from 'zod';

import { LIMITS, Locale, PublishMode } from './constants';
import { isValidTimeZone } from './time';

/**
 * Request schemas. Every API route parses its input through one of these, so
 * route handlers can assume well-formed data and the error messages users see
 * are written once, here.
 */

const timezone = z
  .string()
  .refine(isValidTimeZone, { message: 'Unknown timezone. Use an IANA name such as Europe/Paris.' });

const httpUrl = z
  .string()
  .trim()
  .url('Enter a valid URL.')
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'Links must start with http:// or https://.',
  });

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(200, 'That password is too long.'),
  workspaceName: z.string().trim().max(120).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const postMediaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['image', 'video']),
  url: z.string().min(1),
  storageKey: z.string().optional(),
  mimeType: z.string().optional(),
  altText: z.string().max(1000).optional(),
});

export const createPostSchema = z
  .object({
    message: z.string().max(LIMITS.messageLength, 'That message is too long for Facebook.').default(''),
    link: httpUrl.nullish(),
    media: z.array(postMediaSchema).max(LIMITS.mediaPerPost).default([]),
    targetIds: z
      .array(z.string().min(1))
      .min(1, 'Choose at least one page or group.')
      .max(LIMITS.targetsPerPost),
    publishMode: z.nativeEnum(PublishMode).default(PublishMode.worker),
    /** Wall-clock time as typed by the user, interpreted in `timezone`. */
    scheduledAtLocal: z.string().min(10).nullish(),
    timezone: timezone.default('UTC'),
    /** Ignore scheduledAtLocal and use the next free queue slot instead. */
    useQueue: z.boolean().default(false),
    saveAsDraft: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const hasContent = value.message.trim().length > 0 || Boolean(value.link) || value.media.length > 0;
    if (!hasContent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['message'],
        message: 'Write something, add a link, or attach media.',
      });
    }

    const needsTime = !value.saveAsDraft && value.publishMode !== 'immediate' && !value.useQueue;
    if (needsTime && !value.scheduledAtLocal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledAtLocal'],
        message: 'Pick a date and time, or add the post to your queue.',
      });
    }

    const videos = value.media.filter((item) => item.kind === 'video');
    if (videos.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['media'],
        message: 'A post can include at most one video.',
      });
    }
    if (videos.length > 0 && value.media.length > videos.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['media'],
        message: 'Facebook cannot combine a video with photos in one post.',
      });
    }
  });

export const updatePostSchema = z.object({
  message: z.string().max(LIMITS.messageLength).optional(),
  link: httpUrl.nullish(),
  media: z.array(postMediaSchema).max(LIMITS.mediaPerPost).optional(),
  targetIds: z.array(z.string().min(1)).min(1).max(LIMITS.targetsPerPost).optional(),
  scheduledAtLocal: z.string().min(10).nullish(),
  timezone: timezone.optional(),
  publishMode: z.nativeEnum(PublishMode).optional(),
  status: z.enum(['draft', 'scheduled', 'cancelled']).optional(),
});

export const linkPreviewSchema = z.object({
  url: httpUrl,
  /** Force a fresh scrape rather than using the cached preview. */
  refresh: z.boolean().default(false),
});

export const targetUpdateSchema = z.object({
  enabled: z.boolean().optional(),
});

export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  timezone: timezone.optional(),
  defaultLocale: z.nativeEnum(Locale).optional(),
  requiresApproval: z.boolean().optional(),

  // Link tagging. Empty string means "clear it", so these are nullable rather
  // than merely optional.
  utmSource: z.string().trim().max(100).nullish(),
  utmMedium: z.string().trim().max(100).nullish(),
  utmCampaignTemplate: z.string().trim().max(200).nullish(),
  shortenerEnabled: z.boolean().optional(),

  aiEnabled: z.boolean().optional(),
  aiTone: z.string().trim().max(50).nullish(),
  aiBrandVoice: z.string().trim().max(2000).nullish(),
});

export const queueSlotsSchema = z.object({
  slots: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59),
      }),
    )
    .max(100),
});

/**
 * One row of a bulk upload. The CSV columns are:
 * `message,link,scheduled_at,media_url`
 */
export const bulkRowSchema = z.object({
  message: z.string().max(LIMITS.messageLength).default(''),
  link: z.string().trim().optional(),
  scheduled_at: z.string().trim().optional(),
  media_url: z.string().trim().optional(),
});

export const bulkUploadSchema = z.object({
  csv: z
    .string()
    .min(1, 'The file is empty.')
    .max(LIMITS.bulkCsvBytes, 'That file is too large to process in one upload. Split it up.'),
  targetIds: z.array(z.string().min(1)).min(1, 'Choose at least one destination.'),
  timezone: timezone.default('UTC'),
  publishMode: z.nativeEnum(PublishMode).default(PublishMode.worker),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type BulkUploadInput = z.infer<typeof bulkUploadSchema>;

/** Flatten Zod issues into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}
