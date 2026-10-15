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
}

export interface DiscoveryRequest { credential: PlatformCredential }
export interface DiscoveryResult { targets: PlatformTarget[]; adAccounts?: PlatformAdAccount[] }
export interface PublishRequest {
  credential: PlatformCredential;
  target: PlatformTarget;
  text: string;
  link?: string | null;
  media?: PublishMedia[];
  firstComment?: string | null;
}
export interface PublishResult { remoteId: string; url: string | null }
export interface RemoteStatusRequest { credential: PlatformCredential; remoteId: string }
export interface RemoteStatus { state: 'published' | 'scheduled' | 'unknown'; publishedAt?: Date | null }
export interface RemoteDeleteRequest { credential: PlatformCredential; remoteId: string }
export interface InboxRequest { credential: PlatformCredential; targetId: string }
export interface InboxItem {
  id: string;
  text: string;
  createdAt: Date;
  targetId?: string;
  parentId?: string | null;
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
export type FacebookCampaignObjective = 'OUTCOME_AWARENESS' | 'OUTCOME_ENGAGEMENT' | 'OUTCOME_LEADS' | 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC' | 'OUTCOME_APP_PROMOTION';
export interface AdCampaignCreateRequest {
  credential: PlatformCredential;
  accountId: string;
  name: string;
  objective: FacebookCampaignObjective;
}

/** Optional members are intentionally absent when the provider slice does not implement them. */
export interface PlatformAdapter {
  readonly id: string;
  readonly capabilities: CapabilityDeclaration;
  supportsTargetKind?(kind: string, capability: 'publishing' | 'inbox' | 'analytics'): boolean;
  getAuthorizationUrl?(request: OAuthStartRequest): string;
  exchangeCode?(request: OAuthExchangeRequest): Promise<OAuthToken>;
  discover?(request: DiscoveryRequest): Promise<DiscoveryResult>;
  publish?(request: PublishRequest): Promise<PublishResult>;
  getRemoteStatus?(request: RemoteStatusRequest): Promise<RemoteStatus>;
  deleteRemote?(request: RemoteDeleteRequest): Promise<void>;
  listInbox?(request: InboxRequest): Promise<InboxItem[]>;
  replyToInbox?(request: InboxActionRequest): Promise<{ remoteId: string }>;
  hideInboxItem?(request: InboxActionRequest & { hidden: boolean }): Promise<void>;
  deleteInboxItem?(request: InboxActionRequest): Promise<void>;
  getAnalytics?(request: AnalyticsRequest): Promise<AnalyticsResult>;
  listAds?(request: AdsRequest): Promise<AdsResult>;
  updateAd?(request: AdMutationRequest): Promise<void>;
  createCampaign?(request: AdCampaignCreateRequest): Promise<{ remoteId: string }>;
}
