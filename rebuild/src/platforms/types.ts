/** Platform-neutral contracts. A capability is present only when it is usable. */
export type CapabilityState = 'supported' | 'unsupported';

export interface CapabilityDeclaration {
  connection: CapabilityState;
  discovery: CapabilityState;
  publishing: CapabilityState;
  remoteStatus: CapabilityState;
  remoteDelete: CapabilityState;
  inbox: CapabilityState;
  analytics: CapabilityState;
  ads: CapabilityState;
}

export interface PlatformCredential {
  accessToken: string;
  grantedScopes?: readonly string[];
}

export interface OAuthStartRequest {
  appId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}
export interface OAuthExchangeRequest {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}
export interface OAuthToken {
  accessToken: string;
  expiresAt?: Date | null;
}

export interface PlatformTarget {
  id: string;
  name: string;
  kind: string;
}

export interface PlatformAdAccount {
  id: string;
  name: string;
  currency?: string | null;
  status?: string | null;
}

export interface PublishMedia {
  kind: 'image' | 'video';
  url: string;
  altText?: string;
  /** Ephemeral server-only bytes for uploading locally stored media; never persisted with a draft. */
  localFile?: { bytes: Uint8Array; mimeType: string; fileName: string };
}

/** Safe media-format metadata used by shared Publishing authoring and destination choices. */
export interface PublishingMediaSupport {
  kinds: readonly ('image' | 'video')[];
  /** Null means the module relies on the shared Root media ceiling. */
  maxImages: number | null;
  maxVideos: number | null;
  mixedKinds: boolean;
  linkWithMedia: boolean;
  imageAltText: boolean;
}

/** Customer-safe, provider-declared formats. Identifiers are opaque to product logic. */
export interface PublishingFormatDescriptor {
  id: string;
  label: string;
  media: PublishingMediaSupport;
  firstComment: boolean;
  remoteStatus: boolean;
  remoteDelete: boolean;
  /**
   * `native` means the provider can hold the post itself. `nativeLeadSeconds` are the provider's accepted lead times
   * (min/max seconds from now); a format without them is not offered the provider-held choice by shared authoring.
   */
  scheduling: { application: boolean; native: boolean; nativeLeadSeconds?: { min: number; max: number } };
}

export interface DiscoveryRequest { credential: PlatformCredential }
export interface DiscoveryResult { targets: PlatformTarget[]; adAccounts?: PlatformAdAccount[] }
export interface PublishRequest {
  credential: PlatformCredential;
  target: PlatformTarget;
  /** Opaque correlation identity for this attempt; it does not imply provider idempotency. */
  operationId?: string;
  /** Explicit format intent; omitted requests use the adapter-declared default. */
  formatId?: string;
  text: string;
  link?: string | null;
  media?: PublishMedia[];
  /** Provider-held schedule instant. Set only for a format whose descriptor declares native scheduling. */
  scheduledAt?: Date | null;
  /** Local identities of the shared publication claim, for modules that keep their own tenant-bound child journal. */
  publication?: { workspaceId: string; postId: string; postTargetId: string; targetId: string; actorId: string };
  signal?: AbortSignal;
}
export interface PublishResult {
  remoteId: string;
  url: string | null;
  /**
   * Required receipt meaning: a submission identity is not proof of live content. `scheduled` means the provider accepted and
   * now holds the post for the requested `scheduledAt`; it is not live until the provider reports it published.
   */
  state: 'published' | 'submitted' | 'scheduled';
  /** Set when the provider now holds the post until this instant (provider-held scheduling). Implies `submitted`. */
  heldUntil?: Date | null;
}
export interface FirstCommentRequest {
  credential: PlatformCredential;
  remotePostId: string;
  /** Format intent of the destination being commented on; modules refuse formats that declare no first comment. */
  formatId?: string;
  text: string;
  signal?: AbortSignal;
}
export interface RemoteStatusRequest {
  credential: PlatformCredential;
  target: PlatformTarget;
  remoteId: string;
  formatId?: string;
  contentKind?: 'text' | 'image' | 'video';
  signal?: AbortSignal;
}
export type RemoteStatus =
  | { state: 'unknown'; publishedAt?: Date | null }
  | { state: 'published' | 'scheduled'; remoteId: string; targetId: string; publishedAt?: Date | null };
export interface RemoteDeleteRequest {
  credential: PlatformCredential;
  remoteId: string;
  /** Format intent of the destination being deleted; modules refuse formats that declare no remote delete. */
  formatId?: string;
  signal?: AbortSignal;
}
export interface RemoteRescheduleRequest {
  credential: PlatformCredential;
  target: PlatformTarget;
  remoteId: string;
  formatId?: string;
  scheduledAt: Date;
  signal?: AbortSignal;
}
export interface InboxRequest { credential: PlatformCredential; targetId: string }
export interface InboxCommentsRequest extends InboxRequest { remotePostId: string }
/** Optional provider observations. An absent field means unknown/unread, not an empty result. */
export interface InboxParticipant { id: string | null; name: string | null; pictureUrl?: string | null }
export interface InboxAttachment { type: string | null; url: string | null }
export interface InboxReaction { type: string; count: number }
export interface InboxMetadata {
  authorPictureUrl?: string | null;
  attachments?: InboxAttachment[];
  reactions?: InboxReaction[];
  permalink?: string | null;
  threadId?: string | null;
  participants?: InboxParticipant[];
  labels?: Array<{ id: string; name: string | null }>;
  folder?: string | null;
}
export interface InboxItem {
  id: string;
  text: string;
  createdAt: Date;
  targetId?: string;
  parentId?: string | null;
  conversationId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  kind?: 'comment' | 'message';
  metadata?: InboxMetadata;
}
/** A public review or recommendation left on a channel. Rating is 1 to 5 when the provider uses stars; recommendation covers providers that use a yes/no recommendation instead. */
export interface InboxReview {
  id: string;
  createdAt: Date;
  authorName: string | null;
  rating: number | null;
  recommendation: 'positive' | 'negative' | null;
  text: string | null;
}
export interface InboxActionRequest {
  credential: PlatformCredential;
  targetId: string;
  remoteId: string;
  text?: string;
}
export interface AnalyticsRequest { credential: PlatformCredential; targetId: string; since?: Date; until?: Date }
export interface AnalyticsResult { metrics: Record<string, number | null> }
export interface AdsRequest { credential: PlatformCredential; accountId: string; since?: Date; until?: Date }
export interface AdsResult { items: unknown[] }
export interface AdMutationRequest {
  credential: PlatformCredential;
  accountId: string;
  objectId: string;
  objectType: 'campaign' | 'adset' | 'ad';
  status?: 'active' | 'paused';
  dailyBudgetMinor?: number;
  lifetimeBudgetMinor?: number;
}
export interface AdObjectReadRequest {
  credential: PlatformCredential;
  accountId: string;
  objectId: string;
  objectType: 'campaign' | 'adset' | 'ad';
}
export interface AdObjectSnapshot {
  id: string;
  name: string | null;
  accountId: string;
  configuredStatus: string | null;
  effectiveStatus: string | null;
}
export interface AdCampaignCreateRequest {
  credential: PlatformCredential;
  accountId: string;
  name: string;
  objective: string;
}

/** Optional members are intentionally absent when the provider slice does not implement them. */
export interface PlatformAdapter {
  readonly id: string;
  readonly capabilities: CapabilityDeclaration;
  /** Optional granular authoring support; absent metadata fails closed for media delivery. */
  readonly publishingMedia?: PublishingMediaSupport;
  readonly publishingFormats?: readonly PublishingFormatDescriptor[];
  readonly defaultPublishingFormatId?: string;
  /** Server-only opaque policy epoch; never a customer capability or secret. */
  readonly statusPolicyFingerprint?: string;
  /** Adapter limits for ephemeral server-supplied image bytes during publish. */
  readonly localImageUpload?: { maxBytes: number; mimeTypes: readonly string[] };
  canUseCredential?(credential: PlatformCredential, capability: 'publishing' | 'remoteStatus' | 'remoteDelete' | 'firstComment'): boolean;
  supportsTargetKind?(kind: string, capability: 'publishing' | 'inbox' | 'analytics'): boolean;
  getAuthorizationUrl?(request: OAuthStartRequest): string;
  exchangeCode?(request: OAuthExchangeRequest): Promise<OAuthToken>;
  discover?(request: DiscoveryRequest): Promise<DiscoveryResult>;
  publish?(request: PublishRequest): Promise<PublishResult>;
  publishFirstComment?(request: FirstCommentRequest): Promise<{ remoteId: string }>;
  classifyPublishingFailure?(error: unknown): 'rejected' | 'uncertain';
  getRemoteStatus?(request: RemoteStatusRequest): Promise<RemoteStatus>;
  deleteRemote?(request: RemoteDeleteRequest): Promise<void>;
  /** Move a post the provider is holding to a new instant. Absent when the provider cannot change a held schedule. */
  rescheduleRemote?(request: RemoteRescheduleRequest): Promise<void>;
  listInbox?(request: InboxRequest): Promise<InboxItem[]>;
  listComments?(request: InboxCommentsRequest): Promise<InboxItem[]>;
  /** Optional: only modules whose provider exposes public reviews declare it. */
  listReviews?(request: InboxRequest): Promise<InboxReview[]>;
  replyToInbox?(request: InboxActionRequest): Promise<{ remoteId: string }>;
  hideInboxItem?(request: InboxActionRequest & { hidden: boolean }): Promise<void>;
  deleteInboxItem?(request: InboxActionRequest): Promise<void>;
  getAnalytics?(request: AnalyticsRequest): Promise<AnalyticsResult>;
  listAds?(request: AdsRequest): Promise<AdsResult>;
  readAdObject?(request: AdObjectReadRequest): Promise<AdObjectSnapshot>;
  updateAd?(request: AdMutationRequest): Promise<void>;
  createCampaign?(request: AdCampaignCreateRequest): Promise<{ remoteId: string }>;
}
