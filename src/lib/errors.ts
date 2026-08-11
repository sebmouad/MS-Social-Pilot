/**
 * Application errors that carry a translation key rather than a finished
 * sentence.
 *
 * Previously these were thrown as `GraphError` with an English message, which
 * conflated two different things: a failure reported *by Facebook* and a rule
 * enforced *by this app*. Only the latter can be translated — Facebook's own
 * error text arrives in one language and is passed through as-is.
 *
 * The English `fallback` is kept so the worker, tests and logs (which have no
 * request locale) still read sensibly.
 */

export type MessageParams = Record<string, string | number>;

export class AppError extends Error {
  /** Dotted key into the message catalogues, e.g. "errors.queueEmpty". */
  readonly key: string;
  readonly params: MessageParams;
  readonly status: number;

  constructor(options: {
    key: string;
    fallback: string;
    params?: MessageParams;
    status?: number;
  }) {
    super(options.fallback);
    this.name = 'AppError';
    this.key = options.key;
    this.params = options.params ?? {};
    this.status = options.status ?? 400;
  }
}

/** Shorthands for the errors thrown from more than one place. */
export const errors = {
  notFound: (what = 'errors.notFound') => new AppError({ key: what, fallback: 'Not found.', status: 404 }),

  postNotFound: () =>
    new AppError({ key: 'errors.postNotFound', fallback: 'Post not found.', status: 404 }),

  noPermission: () =>
    new AppError({
      key: 'errors.noPermission',
      fallback: 'You do not have permission to do that.',
      status: 403,
    }),

  targetsUnavailable: () =>
    new AppError({
      key: 'errors.targetsUnavailable',
      fallback: 'One or more selected destinations are no longer available.',
    }),

  targetsDisabled: (names: string) =>
    new AppError({
      key: 'errors.targetsDisabled',
      fallback: `These destinations are turned off: ${names}.`,
      params: { names },
    }),

  queueEmpty: () =>
    new AppError({
      key: 'errors.queueEmpty',
      fallback: 'Your posting queue is empty. Add publishing times in Settings first.',
    }),

  queueFull: () =>
    new AppError({
      key: 'errors.queueFull',
      fallback: 'Every queue slot in the next 90 days is taken. Add more times or pick a date.',
    }),

  pickDateTime: () =>
    new AppError({ key: 'errors.pickDateTime', fallback: 'Pick a date and time for this post.' }),

  timePassed: () =>
    new AppError({
      key: 'errors.timePassed',
      fallback: 'That time has already passed. Choose a time in the future.',
    }),

  nativeGroupsUnsupported: (names: string) =>
    new AppError({
      key: 'errors.nativeGroupsUnsupported',
      fallback: `Facebook cannot natively schedule Group posts (${names}). Use the built-in scheduler for these.`,
      params: { names },
    }),

  alreadyPublishing: () =>
    new AppError({
      key: 'errors.alreadyPublishing',
      fallback: 'This post is being published right now and can no longer be edited.',
      status: 409,
    }),

  alreadyPublished: () =>
    new AppError({
      key: 'errors.alreadyPublished',
      fallback: 'This post has already been published. Create a new post instead.',
      status: 409,
    }),

  scheduledInFacebook: () =>
    new AppError({
      key: 'errors.scheduledInFacebook',
      fallback:
        'This post is scheduled inside Facebook. Cancel it first, which deletes it from Facebook, then schedule a new one.',
      status: 409,
    }),

  awaitingApproval: () =>
    new AppError({
      key: 'errors.awaitingApproval',
      fallback: 'This post is waiting for approval and cannot be published yet.',
      status: 409,
    }),

  variantsNeedApproval: () =>
    new AppError({
      key: 'errors.variantsNeedApproval',
      fallback:
        'Alternate wordings publish without review, so only editors and above can set them while approval is on.',
      status: 403,
    }),

  bulkTooManyRows: (rows: number, limit: number) =>
    new AppError({
      key: 'errors.bulkTooManyRows',
      fallback: `That file has ${rows} rows and the limit is ${limit}. Split it into smaller uploads.`,
      params: { rows, limit },
      status: 422,
    }),

  csvUnterminatedQuote: (line: number) =>
    new AppError({
      key: 'errors.csvUnterminatedQuote',
      fallback: `A quoted field starting on line ${line} is never closed, so everything after it was read as one value. Add the missing " and upload again.`,
      params: { line },
      status: 422,
    }),

  aiRateLimited: () =>
    new AppError({
      key: 'errors.aiRateLimited',
      fallback: 'You have reached the AI usage limit for this hour. Try again shortly.',
      status: 429,
    }),

  aiNotConfigured: () =>
    new AppError({
      key: 'errors.aiNotConfigured',
      fallback: 'AI assistance is not configured on this server.',
      status: 503,
    }),
};
