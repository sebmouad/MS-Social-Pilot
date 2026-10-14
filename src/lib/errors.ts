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
  /**
   * Per-field detail for a form, in the same shape a Zod failure produces, so
   * the client has one error format to understand rather than two.
   */
  readonly fields?: Record<string, string>;

  constructor(options: {
    key: string;
    fallback: string;
    params?: MessageParams;
    status?: number;
    fields?: Record<string, string>;
  }) {
    super(options.fallback);
    this.name = 'AppError';
    this.key = options.key;
    this.params = options.params ?? {};
    this.status = options.status ?? 400;
    this.fields = options.fields;
  }
}

/** Shorthands for the errors thrown from more than one place. */
export const errors = {
  exportNeedsAllPages: () =>
    new AppError({ key: 'errors.exportNeedsAllPages', fallback: 'This export covers the whole workspace. Ask an admin for access to every profile.', status: 403 }),
  rootNoSuchUser: () =>
    new AppError({ key: 'errors.rootNoSuchUser', fallback: 'Nobody has an account with that email. Invite them from Registration instead.', status: 404 }),
  rootAlreadyMember: () =>
    new AppError({ key: 'errors.rootAlreadyMember', fallback: 'That person is already a member of this workspace.', status: 409 }),
  rootLastOwner: () =>
    new AppError({ key: 'errors.rootLastOwner', fallback: 'A workspace needs an owner. Make someone else owner first.', status: 422 }),
  workspaceSuspended: () =>
    new AppError({ key: 'errors.workspaceSuspended', fallback: 'This workspace is suspended. Contact the service administrator.', status: 403 }),
  viewerReadOnly: () =>
    new AppError({ key: 'errors.viewerReadOnly', fallback: 'Viewers can look but not change anything.', status: 403 }),
  developerFeaturesOff: () =>
    new AppError({ key: 'errors.developerFeaturesOff', fallback: 'Developer features are not switched on for this workspace.', status: 403 }),
  moduleOff: () =>
    new AppError({ key: 'errors.moduleOff', fallback: 'This part of the app is not switched on for you.', status: 403 }),
  accountNotFound: () =>
    new AppError({ key: 'errors.accountNotFound', fallback: 'Account not found.', status: 404 }),
  destinationNotFound: () =>
    new AppError({ key: 'errors.destinationNotFound', fallback: 'Destination not found.', status: 404 }),
  fileNotFound: () =>
    new AppError({ key: 'errors.fileNotFound', fallback: 'File not found.', status: 404 }),
  feedNotFound: () =>
    new AppError({ key: 'errors.feedNotFound', fallback: 'Feed not found.', status: 404 }),
  commentNotFound: () =>
    new AppError({ key: 'errors.commentNotFound', fallback: 'Comment not found.', status: 404 }),
  conversationNotFound: () =>
    new AppError({ key: 'errors.conversationNotFound', fallback: 'Conversation not found.', status: 404 }),
  instagramNotFound: () =>
    new AppError({ key: 'errors.instagramNotFound', fallback: 'Instagram account not found.', status: 404 }),
  adminsOnlyConnect: () =>
    new AppError({ key: 'errors.adminsOnlyConnect', fallback: 'Only workspace owners and admins can connect accounts.', status: 403 }),
  adminsOnlyDisconnect: () =>
    new AppError({ key: 'errors.adminsOnlyDisconnect', fallback: 'Only workspace owners and admins can disconnect accounts.', status: 403 }),
  adminsOnlyRefresh: () =>
    new AppError({ key: 'errors.adminsOnlyRefresh', fallback: 'Only workspace owners and admins can refresh connections.', status: 403 }),
  adminsOnlyHealthCheck: () =>
    new AppError({ key: 'errors.adminsOnlyHealthCheck', fallback: 'Only workspace owners and admins can run connection checks.', status: 403 }),
  adminsOnlyConnections: () =>
    new AppError({ key: 'errors.adminsOnlyConnections', fallback: 'Only workspace owners and admins can change connections.', status: 403 }),
  adminsOnlyDestinations: () =>
    new AppError({ key: 'errors.adminsOnlyDestinations', fallback: 'Only workspace owners and admins can change destinations.', status: 403 }),
  adminsOnlySettings: () =>
    new AppError({ key: 'errors.adminsOnlySettings', fallback: 'Only workspace owners and admins can change these settings.', status: 403 }),
  adminsOnlySchedule: () =>
    new AppError({ key: 'errors.adminsOnlySchedule', fallback: 'Only workspace owners and admins can change the publishing schedule.', status: 403 }),
  adminsOnlyDeleteComments: () =>
    new AppError({ key: 'errors.adminsOnlyDeleteComments', fallback: 'Only workspace owners and admins can delete comments on Facebook.', status: 403 }),
  cannotChangeConnections: () =>
    new AppError({ key: 'errors.cannotChangeConnections', fallback: 'You cannot change connections.', status: 403 }),
  editorsOnlyDeleteMedia: () =>
    new AppError({ key: 'errors.editorsOnlyDeleteMedia', fallback: 'Only editors and above can delete files from the library.', status: 403 }),
  ownerOnlyViewConfig: () =>
    new AppError({ key: 'errors.ownerOnlyViewConfig', fallback: 'Only an owner can view configuration.', status: 403 }),
  ownerOnlyChangeConfig: () =>
    new AppError({ key: 'errors.ownerOnlyChangeConfig', fallback: 'Only an owner can change configuration.', status: 403 }),
  ownerOnlyViewSetup: () =>
    new AppError({ key: 'errors.ownerOnlyViewSetup', fallback: 'Only an owner can view setup.', status: 403 }),
  ownerOnlyChangeSetup: () =>
    new AppError({ key: 'errors.ownerOnlyChangeSetup', fallback: 'Only an owner can change setup.', status: 403 }),
  publishOwnOnly: () =>
    new AppError({ key: 'errors.publishOwnOnly', fallback: 'You can only publish your own posts.', status: 403 }),
  moderateNoPermission: () =>
    new AppError({ key: 'errors.moderateNoPermission', fallback: 'You do not have permission to moderate comments.', status: 403 }),
  replyNoPermission: () =>
    new AppError({ key: 'errors.replyNoPermission', fallback: 'You do not have permission to reply to messages.', status: 403 }),
  conversationGone: () =>
    new AppError({ key: 'errors.conversationGone', fallback: 'This conversation is no longer on Facebook.', status: 410 }),
  commentGone: () =>
    new AppError({ key: 'errors.commentGone', fallback: 'That comment is no longer on Facebook — somebody deleted it there. It has been removed from this list.', status: 410 }),
  noRecipient: () =>
    new AppError({ key: 'errors.noRecipient', fallback: 'Nobody to reply to: the last message in this thread is the Page’s own.', status: 409 }),
  replyWindowClosed: () =>
    new AppError({ key: 'errors.replyWindowClosed', fallback: 'Facebook only allows a reply within 24 hours of the last message from the person. This thread has gone quiet for longer, so a reply would be refused.', status: 409 }),
  heldByFacebook: () =>
    new AppError({ key: 'errors.heldByFacebook', fallback: 'Facebook is already holding this post for its scheduled time. Cancel it first to publish now.', status: 409 }),
  noPageToRefresh: () =>
    new AppError({ key: 'errors.noPageToRefresh', fallback: 'No Facebook Page to refresh.', status: 404 }),
  noInstagramConnected: () =>
    new AppError({ key: 'errors.noInstagramConnected', fallback: 'No Instagram account connected.', status: 404 }),
  noAdAccount: () =>
    new AppError({ key: 'errors.noAdAccount', fallback: 'No ad account connected.', status: 404 }),
  attachFile: () =>
    new AppError({ key: 'errors.attachFile', fallback: 'Attach a file to upload.', status: 400 }),
  dateRange: () =>
    new AppError({ key: 'errors.dateRange', fallback: 'Enter a valid date range.', status: 400 }),
  fileTooLarge: (limit: string | number) =>
    new AppError({
      key: 'errors.fileTooLarge',
      fallback: `That file is larger than the ${limit} MB limit.`,
      params: { limit },
      status: 413,
    }),
  quotaFull: (quota: string | number, used: string | number) =>
    new AppError({
      key: 'errors.quotaFull',
      fallback: `This client has used ${used} MB of its ${quota} MB media allowance. Delete some files, or raise the limit in Configuration.`,
      params: { quota, used },
      status: 413,
    }),
  mediaInUse: (count: string | number, postIds: string) =>
    new AppError({
      key: 'errors.mediaInUse',
      fallback: `This file is still used by ${count} post(s) that have not gone out yet. Remove it from them first.`,
      params: { count },
      status: 409,
      fields: { posts: postIds },
    }),
  unknownExport: (kinds: string | number) =>
    new AppError({
      key: 'errors.unknownExport',
      fallback: `Unknown export. Choose one of: ${kinds}.`,
      params: { kinds },
      status: 400,
    }),
  previewUrlInvalid: () =>
    new AppError({ key: 'errors.previewUrlInvalid', fallback: 'Enter a valid URL, including http:// or https://.', status: 400 }),
  previewSchemeUnsupported: () =>
    new AppError({ key: 'errors.previewSchemeUnsupported', fallback: 'Only http and https URLs can be previewed.', status: 400 }),
  previewHostBlocked: () =>
    new AppError({ key: 'errors.previewHostBlocked', fallback: 'That host is not reachable for link previews.', status: 400 }),

  ruleNeedsKeywords: () =>
    new AppError({ key: 'errors.ruleNeedsKeywords', fallback: 'Add at least one word to look for.', status: 400 }),
  ruleNeedsReply: () =>
    new AppError({ key: 'errors.ruleNeedsReply', fallback: 'Write the reply the Page should post.', status: 400 }),
  undoFailed: (reason: string) =>
    new AppError({ key: 'errors.undoFailed', fallback: `This could not be undone: ${reason}`, params: { reason }, status: 502 }),

  notFound: (what = 'errors.notFound') => new AppError({ key: what, fallback: 'Not found.', status: 404 }),

  noScheduledTime: () =>
    new AppError({ key: 'errors.noScheduledTime', fallback: 'This post has no date to move.', status: 422 }),
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

  nativeInstagramUnsupported: (names: string) =>
    new AppError({
      key: 'errors.nativeInstagramUnsupported',
      fallback: `Instagram has no scheduling of its own (${names}). Use the built-in scheduler for these.`,
      params: { names },
    }),

  instagramNeedsMedia: (names: string) =>
    new AppError({
      key: 'errors.instagramNeedsMedia',
      fallback: `Instagram publishes a photo or a video, never text alone (${names}). Add media, or leave Instagram out.`,
      params: { names },
      status: 422,
    }),

  feedInstagramUnsupported: (names: string) =>
    new AppError({
      key: 'errors.feedInstagramUnsupported',
      fallback: `A feed item is a headline and a link, and Instagram takes neither without a picture (${names}). Choose Facebook destinations for this feed.`,
      params: { names },
      status: 422,
    }),

  feedUrlBlocked: () =>
    new AppError({
      key: 'errors.feedUrlBlocked',
      fallback: 'That feed address points at a private network, which this server does not fetch. Use the feed’s public address.',
      status: 422,
    }),

  clocksGoForward: (when: string) =>
    new AppError({
      key: 'errors.clocksGoForward',
      fallback: `The clocks go forward that night, so ${when} does not happen in this workspace's timezone. Choose a time before or after the missing hour.`,
      params: { when },
      status: 422,
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

  unconfirmedRemotePost: () =>
    new AppError({
      key: 'errors.unconfirmedRemotePost',
      fallback: 'Facebook never confirmed this scheduled post. Check the Page before creating another copy; this one cannot be retried or edited safely.',
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

  tooManyAttempts: (minutes: number) =>
    new AppError({
      key: 'errors.tooManyAttempts',
      fallback: `Too many sign-in attempts. Try again in ${minutes} minute(s).`,
      params: { minutes },
      status: 429,
    }),

  // Sign-in and sign-up refusals have their own keys. They used to be thrown as
  // `AuthError`, which the API renders as "You must be signed in." — so a
  // mistyped password, on the sign-in form, told the person to sign in.
  invalidCredentials: () =>
    new AppError({ key: 'errors.invalidCredentials', fallback: 'Incorrect email or password.', status: 401 }),
  soleOwner: () =>
    new AppError({ key: 'errors.soleOwner', fallback: 'This person is the only owner of a workspace. Give it another owner or delete it first.', status: 409 }),
  noUserWithEmail: () =>
    new AppError({ key: 'errors.noUserWithEmail', fallback: 'Nobody has an account with that email yet. Invite them first.', status: 404 }),
  rootCannotBeDisabled: () =>
    new AppError({
      key: 'errors.rootCannotBeDisabled',
      fallback: 'Root cannot be disabled or signed out from here. Hand root to someone else first.',
      status: 409,
    }),
  rootTargetDisabled: () =>
    new AppError({
      key: 'errors.rootTargetDisabled',
      fallback: 'That account is disabled. Enable it before handing root to it.',
      status: 409,
    }),
  twoStepWrongCode: () =>
    new AppError({ key: 'errors.twoStepWrongCode', fallback: 'That code is not right, or was already used. Try the newest code.', status: 401 }),
  twoStepNotStarted: () =>
    new AppError({ key: 'errors.twoStepNotStarted', fallback: 'Start setting up the authenticator app again.', status: 409 }),
  twoStepRequired: () =>
    new AppError({ key: 'errors.twoStepRequired', fallback: 'Two-step sign-in is required for your account, so it cannot be turned off.', status: 409 }),
  twoStepExpired: () =>
    new AppError({ key: 'errors.twoStepExpired', fallback: 'This sign-in took too long. Enter your email and password again.', status: 401 }),
  passkeyFailed: () =>
    new AppError({ key: 'errors.passkeyFailed', fallback: 'The passkey could not be checked. Try again, or use a code.', status: 401 }),
  accountDisabled: () =>
    new AppError({
      key: 'errors.accountDisabled',
      fallback: 'This account has been disabled by the administrator of this installation.',
      status: 403,
    }),
  emailTaken: () =>
    new AppError({
      key: 'errors.emailTaken',
      fallback: 'An account with that email already exists. Sign in instead.',
      status: 409,
    }),

  tooManySignups: (minutes: number) =>
    new AppError({
      key: 'errors.tooManySignups',
      fallback: `Too many accounts created from here. Try again in ${minutes} minute(s).`,
      params: { minutes },
      status: 429,
    }),

  currentPasswordWrong: () =>
    new AppError({ key: 'errors.currentPasswordWrong', fallback: 'Your current password is not correct.', status: 422 }),
  passwordUnchanged: () =>
    new AppError({ key: 'errors.passwordUnchanged', fallback: 'Choose a password different from the current one.', status: 422 }),

  registrationClosed: () =>
    new AppError({
      key: 'errors.registrationClosed',
      fallback: 'This server does not accept new accounts. Ask an administrator to invite you.',
      status: 403,
    }),

  aiRateLimited: () =>
    new AppError({
      key: 'errors.aiRateLimited',
      fallback: 'You have reached the AI usage limit for this hour. Try again shortly.',
      status: 429,
    }),

  aiBudgetReached: () =>
    new AppError({
      key: 'errors.aiBudgetReached',
      fallback: 'This month\'s AI budget has been reached. AI help is back next month, or sooner if the administrator raises the budget.',
      status: 429,
    }),
  resetLinkInvalid: () =>
    new AppError({
      key: 'errors.resetLinkInvalid',
      fallback: 'This link has expired or was already used. Ask for a new one.',
      status: 400,
    }),
  tooManyEmails: (minutes: number) =>
    new AppError({
      key: 'errors.tooManyEmails',
      fallback: `Too many emails asked for. Try again in ${minutes} minute(s).`,
      params: { minutes },
      status: 429,
    }),
  workspaceBusy: (seconds: number) =>
    new AppError({
      key: 'errors.workspaceBusy',
      fallback: `This workspace is sending too many requests. Try again in ${seconds} second(s).`,
      params: { seconds },
      status: 429,
    }),
  emailNotVerified: () =>
    new AppError({
      key: 'errors.emailNotVerified',
      fallback: 'Confirm your email address first: open the link we sent you.',
      status: 403,
    }),
  aiNotConfigured: () =>
    new AppError({
      key: 'errors.aiNotConfigured',
      fallback: 'AI assistance is not configured on this server.',
      status: 503,
    }),

  aiPlanEmpty: () =>
    new AppError({
      key: 'errors.aiPlanEmpty',
      fallback: 'The AI did not come back with a usable plan. Try again, or say a little more about the week.',
      status: 502,
    }),

  publishNeedsReview: () =>
    new AppError({
      key: 'errors.publishNeedsReview',
      fallback:
        'Posts in this workspace are reviewed before they go out, so they cannot be published on the spot. Schedule it and it will go to the approval queue.',
      status: 403,
    }),

  textBackgroundNeedsText: () =>
    new AppError({
      key: 'errors.textBackgroundNeedsText',
      fallback: 'A coloured background is for a short text post: no link, pictures or video, and at most 130 characters.',
      status: 422,
    }),

  emptyPost: () =>
    new AppError({
      key: 'errors.emptyPost',
      fallback: 'Write something, add a link, or attach media.',
      status: 422,
    }),

  refreshNoPermission: () =>
    new AppError({
      key: 'errors.refreshNoPermission',
      fallback: 'Only editors and above can pull comments and messages from Facebook.',
      status: 403,
    }),

  refreshTooSoon: (seconds: number) =>
    new AppError({
      key: 'errors.refreshTooSoon',
      fallback: `This workspace has just pulled from Facebook. Try again in ${seconds} second(s).`,
      params: { seconds },
      status: 429,
    }),

  dateRangeInverted: () =>
    new AppError({
      key: 'errors.dateRangeInverted',
      fallback: 'The start of the range comes after its end. Swap the dates.',
      status: 400,
    }),

  adAccountNotFound: () =>
    new AppError({ key: 'errors.adAccountNotFound', fallback: 'Ad account not found.', status: 404 }),

  destinationBlocked: () =>
    new AppError({
      key: 'errors.destinationBlocked',
      fallback: 'This destination cannot be published to right now, so it cannot be turned on.',
      status: 409,
    }),
};
