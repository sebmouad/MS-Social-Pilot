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
  /** Ephemeral server-only bytes for uploading a locally stored image; never persisted with a draft. */
  localFile?: { bytes: Uint8Array; mimeType: string; fileName: string };
}

export interface DiscoveryRequest { credential: PlatformCredential }
export interface DiscoveryResult { targets: PlatformTarget[]; adAccounts?: PlatformAdAccount[] }
export interface PublishRequest {
  credential: PlatformCredential;
  target: PlatformTarget;
  text: string;
  link?: string | null;
  media?: PublishMedia[];
  signal?: AbortSignal;
}
export interface PublishResult { remoteId: string; url: string | null }
export interface FirstCommentRequest {
  credential: PlatformCredential;
  remotePostId: string;
  text: string;
  signal?: AbortSignal;
}
export interface RemoteStatusRequest { credential: PlatformCredential; remoteId: string; signal?: AbortSignal }
export interface RemoteStatus { state: 'published' | 'scheduled' | 'unknown'; publishedAt?: Date | null }
export interface RemoteDeleteRequest { credential: PlatformCredential; remoteId: string; signal?: AbortSignal }
export interface InboxRequest { credential: PlatformCredential; targetId: string }
export interface InboxCommentsRequest extends InboxRequest { remotePostId: string }
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
  listInbox?(request: InboxRequest): Promise<InboxItem[]>;
  listComments?(request: InboxCommentsRequest): Promise<InboxItem[]>;
  replyToInbox?(request: InboxActionRequest): Promise<{ remoteId: string }>;
  hideInboxItem?(request: InboxActionRequest & { hidden: boolean }): Promise<void>;
  deleteInboxItem?(request: InboxActionRequest): Promise<void>;
  getAnalytics?(request: AnalyticsRequest): Promise<AnalyticsResult>;
  listAds?(request: AdsRequest): Promise<AdsResult>;
  readAdObject?(request: AdObjectReadRequest): Promise<AdObjectSnapshot>;
  updateAd?(request: AdMutationRequest): Promise<void>;
  createCampaign?(request: AdCampaignCreateRequest): Promise<{ remoteId: string }>;
}
