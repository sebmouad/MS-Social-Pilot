import { z } from 'zod';

import { LIMITS, Locale, PublishMode } from './constants';
import { isValidTimeZone } from './time';
import { THEMES } from './themes';
import { CLIENT_SWITCHES } from './role-access';
import { COUNTRY_CODES, CULTURAL_CALENDARS, canonicalLanguage } from './audience';

/**
 * Request schemas. Every API route parses its input through one of these, so
 * route handlers can assume well-formed data and the error messages users see
 * are written once, here.
 */

export const timezone = z
  .string()
  .refine(isValidTimeZone, { message: 'Unknown timezone. Use an IANA name such as Europe/Paris.' });

export const httpUrl = z
  .string()
  .trim()
  .url('Enter a valid URL.')
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'Links must start with http:// or https://.',
  });

/** One rule for a new password, wherever one is chosen. */
const newPassword = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: newPassword,
  workspaceName: z.string().trim().max(120).optional(),
});

export const profileSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your name.').max(120).optional(),
    locale: z.nativeEnum(Locale).optional(),
    theme: z.enum(THEMES).optional(),
  })
  .refine((value) => value.name !== undefined || value.locale !== undefined || value.theme !== undefined, {
    message: 'Nothing to change.',
  });

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword,
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
});

export const passwordResetSchema = z.object({
  token: z.string().min(1).max(200),
  password: newPassword,
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
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});

const postMessage = z.string().max(LIMITS.messageLength, 'That message is too long for Facebook.');
const postMedia = z.array(postMediaSchema).max(LIMITS.mediaPerPost);
const postTargetIds = z
  .array(z.string().min(1))
  .min(1, 'Choose at least one page or group.')
  .max(LIMITS.targetsPerPost);

/**
 * The content rules a post has to meet however it arrives.
 *
 * Shared by creating and editing because the composer is the same screen for
 * both, and a rule enforced on only one of them is a detour rather than a rule:
 * the edit schema used to have none of these, so a video could be combined with
 * photos by saving once and editing once, and it failed only when Facebook
 * refused it at publish time.
 *
 * An edit may leave fields out, so the emptiness check only runs when all
 * three content fields are present — `updatePost` repeats it against the
 * stored row for the ones that are not.
 */
function refinePostContent(
  value: { message?: string; link?: string | null; media?: Array<{ kind: string }> },
  ctx: z.RefinementCtx,
): void {
  const knowsAllContent =
    value.message !== undefined && value.link !== undefined && value.media !== undefined;
  if (knowsAllContent && !hasPostContent(value.message ?? '', value.link ?? null, value.media?.length ?? 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['message'],
      message: 'Write something, add a link, or attach media.',
    });
  }

  const media = value.media ?? [];
  const videos = media.filter((item) => item.kind === 'video');
  if (videos.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['media'],
      message: 'A post can include at most one video.',
    });
  }
  if (videos.length > 0 && media.length > videos.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['media'],
      message: 'Facebook cannot combine a video with photos in one post.',
    });
  }
}

/** Whether a post has anything in it to publish. */
export function hasPostContent(message: string, link: string | null, mediaCount: number): boolean {
  return message.trim().length > 0 || Boolean(link) || mediaCount > 0;
}

/**
 * The comment posted as the Page under the post when it goes out. Blank means
 * none; Facebook takes comments up to 8,000 characters.
 */
const firstComment = z
  .string()
  .max(8000, 'A first comment can be at most 8,000 characters.')
  .transform((value) => value.trim() || null);

/** How long the first comment waits after the post: up to a week. */
const firstCommentDelay = z.number().int().min(0).max(7 * 24 * 60);

/** A feed post, a Reel or a Story. */
const postFormat = z.enum(['post', 'reel', 'story']);

/** The labels a post carries. Ids are checked against the workspace on save. */
const labelIds = z.array(z.string().min(1)).max(20);

export const createPostSchema = z
  .object({
    message: postMessage.default(''),
    firstComment: firstComment.nullish(),
    firstCommentDelayMinutes: firstCommentDelay.default(0),
    labelIds: labelIds.default([]),
    format: postFormat.default('post'),
    link: httpUrl.nullish(),
    media: postMedia.default([]),
    targetIds: postTargetIds,
    /** Text for single destinations, by destination id; the others publish the post's text. */
    variants: z.record(z.string(), z.string().trim().max(70_000)).optional(),
    /** Destinations that publish without the post's pictures or video. */
    textOnly: z.array(z.string()).max(200).optional(),
    /** Custom field values, by field id. */
    fields: z.record(z.string(), z.string().max(500)).optional(),
    publishMode: z.nativeEnum(PublishMode).default(PublishMode.worker),
    /** Wall-clock time as typed by the user, interpreted in `timezone`. */
    scheduledAtLocal: z.string().min(10).nullish(),
    timezone: timezone.default('UTC'),
    /** Ignore scheduledAtLocal and use the next free queue slot instead. */
    useQueue: z.boolean().default(false),
    saveAsDraft: z.boolean().default(false),
    /**
     * Spam-risk guard (G6): one post per Page, this many minutes apart,
     * instead of one post to every Page at once. 0 or absent sends together.
     */
    staggerMinutes: z.number().int().min(0).max(720).optional(),
    /** With a stagger: the AI rewords the caption for each Page after the first. */
    aiVariants: z.boolean().optional(),
    /**
     * Caption A/B test (G9): captions B, C, D for the same content. The
     * message is caption A.
     */
    captionVariants: z.array(postMessage).max(3).optional(),
    /** Hours after the last caption goes out before the test is read. */
    testHours: z.union([z.literal(24), z.literal(48), z.literal(72), z.literal(168)]).optional(),
    /**
     * AI translation (G11): these Pages get this text instead of the message,
     * one post per translation. Pages in none keep the message.
     */
    translations: z
      .array(z.object({ targetIds: postTargetIds, message: postMessage }))
      .max(LIMITS.targetsPerPost)
      .optional(),
  })
  .superRefine((value, ctx) => {
    // `link` is optional here and absent means none, so it is normalised for
    // the shared check, which reads `undefined` as "not sent".
    refinePostContent({ ...value, link: value.link ?? null }, ctx);

    if (value.captionVariants?.length) {
      if (value.saveAsDraft || value.useQueue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['captionVariants'],
          message: 'A caption test needs a date or Publish now; it cannot be a draft or go to the queue.',
        });
      }
      if (!value.message.trim() || value.captionVariants.some((caption) => !caption.trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['captionVariants'], message: 'Write every caption of the test.' });
      }
    }

    if (value.translations?.length) {
      const ids = value.translations.flatMap((translation) => translation.targetIds);
      if (new Set(ids).size !== ids.length || ids.some((id) => !value.targetIds.includes(id))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['translations'], message: 'Each translation must be for Pages of this post, once each.' });
      }
      if (value.translations.some((translation) => !translation.message.trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['translations'], message: 'A translation is empty.' });
      }
      if (value.captionVariants?.length || (value.staggerMinutes ?? 0) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['translations'],
          message: 'Translations cannot be combined with a caption test or spreading posts out.',
        });
      }
    }

    const needsTime = !value.saveAsDraft && value.publishMode !== 'immediate' && !value.useQueue;
    if (needsTime && !value.scheduledAtLocal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledAtLocal'],
        message: 'Pick a date and time, or add the post to your queue.',
      });
    }
  });

export const updatePostSchema = z
  .object({
    message: postMessage.optional(),
    firstComment: firstComment.nullish(),
    firstCommentDelayMinutes: firstCommentDelay.optional(),
    labelIds: labelIds.optional(),
    format: postFormat.optional(),
    link: httpUrl.nullish(),
    media: postMedia.optional(),
    targetIds: postTargetIds.optional(),
    variants: z.record(z.string(), z.string().trim().max(70_000)).optional(),
    textOnly: z.array(z.string()).max(200).optional(),
    fields: z.record(z.string(), z.string().max(500)).optional(),
    scheduledAtLocal: z.string().min(10).nullish(),
    timezone: timezone.optional(),
    publishMode: z.nativeEnum(PublishMode).optional(),
    status: z.enum(['draft', 'scheduled', 'cancelled']).optional(),
  })
  .superRefine(refinePostContent);

export const linkPreviewSchema = z.object({
  url: httpUrl,
  /** Force a fresh scrape rather than using the cached preview. */
  refresh: z.boolean().default(false),
});

export const targetUpdateSchema = z.object({
  enabled: z.boolean().optional(),
});

/**
 * Target audience (H0), for a Page or as the workspace's default. Absent
 * leaves a part as it is; an empty list or null clears it.
 */
export const audienceFields = {
  audienceCountries: z.array(z.string().refine((code) => COUNTRY_CODES.includes(code), 'Unknown country.')).max(50).optional(),
  audienceLanguages: z
    .array(z.string().max(35).transform((tag, ctx) => canonicalLanguage(tag) ?? (ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a language tag.' }), z.NEVER)))
    .max(20)
    .transform((tags) => [...new Set(tags)])
    .optional(),
  audienceTimezone: timezone.nullish(),
  audienceCalendars: z.array(z.enum(CULTURAL_CALENDARS)).max(CULTURAL_CALENDARS.length).optional(),
};

export const workspaceSettingsSchema = z.object({
  ...audienceFields,
  name: z.string().trim().min(1).max(120).optional(),
  timezone: timezone.optional(),
  defaultLocale: z.nativeEnum(Locale).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  // Business hours for the inbox response time (H11); no days means every hour counts.
  businessDays: z.array(z.number().int().min(0).max(6)).max(7).transform((days) => [...new Set(days)].sort()).optional(),
  businessStart: z.number().int().min(0).max(23).optional(),
  businessEnd: z.number().int().min(1).max(24).optional(),
  requiresApproval: z.boolean().optional(),
  clientApprovalAfterTeam: z.boolean().optional(),

  // Link tagging. Empty string means "clear it", so these are nullable rather
  // than merely optional.
  utmSource: z.string().trim().max(100).nullish(),
  utmMedium: z.string().trim().max(100).nullish(),
  utmCampaignTemplate: z.string().trim().max(200).nullish(),
  shortenerEnabled: z.boolean().optional(),
  spamGapMinutes: z.number().int().min(0).max(720).optional(),
  undoSendSeconds: z.number().int().min(0).max(60).optional(),
  bestTimeMode: z.enum(['suggest', 'apply']).optional(),

  aiEnabled: z.boolean().optional(),
  watchNegativeComments: z.boolean().optional(),
  trendKeywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  aiTone: z.string().trim().max(50).nullish(),
  aiBrandVoice: z.string().trim().max(2000).nullish(),
  aiAvoidWords: z.string().trim().max(1000).nullish(),

  // Report branding: the logo on the cover, and the words around it.
  logoUrl: z.union([httpUrl, z.literal('')]).nullish(),
  reportTitle: z.string().trim().max(120).nullish(),
  reportSubtitle: z.string().trim().max(200).nullish(),
  reportFooter: z.string().trim().max(300).nullish(),
  // What clients of this workspace may open beyond the calendar and approvals.
  clientAccess: z.array(z.enum(CLIENT_SWITCHES)).max(CLIENT_SWITCHES.length).optional(),
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
  /** Whose timetable this is: one Page's own times, or (null) every Page's. */
  targetId: z.string().min(1).nullish(),
});

/**
 * One row of a bulk upload. The CSV columns are:
 * `message,link,scheduled_at,media_url`
 */
/**
 * A CSV cell that is either blank or a URL.
 *
 * Spreadsheets fill missing values with an empty string rather than omitting
 * the column, so blank has to mean absent before the URL rule is applied.
 */
const optionalCsvUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  httpUrl.optional(),
);

/**
 * One row of an uploaded CSV.
 *
 * The URL rules match the composer's on purpose. They were missing here, so a
 * spreadsheet could put anything at all in the link column: it was stored on
 * the post, rendered as an href on the post list and the approvals screen, and
 * only discovered to be unusable when Facebook refused it at publish time. A
 * row that cannot work should be reported as a bad row while the person who
 * uploaded it is still looking at the upload.
 */
export const bulkRowSchema = z.object({
  message: z.string().max(LIMITS.messageLength).default(''),
  link: optionalCsvUrl,
  scheduled_at: z.string().trim().optional(),
  media_url: optionalCsvUrl,
});

export const bulkUploadSchema = z.object({
  csv: z
    .string()
    .min(1, 'The file is empty.')
    .max(LIMITS.bulkCsvBytes, 'That file is too large to process in one upload. Split it up.'),
  targetIds: z.array(z.string().min(1)).min(1, 'Choose at least one destination.'),
  timezone: timezone.default('UTC'),
  // Scheduling modes only. This endpoint's whole shape is scheduling — a row
  // with no time goes into the queue — and publishing a file on the spot is a
  // different, unrecoverable gesture: the rows go to Facebook one after
  // another inside a single request, so the connection times out long before
  // the last one and the uploader is left with no record of which of five
  // hundred posts went out. Posting now stays on the endpoint that does one
  // post per request, where each has its own answer.
  publishMode: z
    .enum([PublishMode.worker, PublishMode.native], {
      message:
        'A CSV can be scheduled or handed to Facebook, but not published on the spot. Post those one at a time.',
    })
    .default(PublishMode.worker),
});

/**
 * The parsed post. The two P1 additions stay optional for callers that build
 * one by hand — the CSV upload, RSS, tests — which have neither to give.
 */
export type CreatePostInput = Omit<z.infer<typeof createPostSchema>, 'firstCommentDelayMinutes' | 'labelIds' | 'format'> &
  Partial<Pick<z.infer<typeof createPostSchema>, 'firstCommentDelayMinutes' | 'labelIds' | 'format'>>;
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

/** A saved reply for comments and Messenger (NEXT_PHASES G8). */
export const savedReplySchema = z.object({
  name: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
});
