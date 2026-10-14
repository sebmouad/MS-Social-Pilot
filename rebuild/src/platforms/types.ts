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

export interface PlatformTarget {
  id: string;
  name: string;
  kind: string;
}

export interface DiscoveryRequest { credential: PlatformCredential }
export interface DiscoveryResult { targets: PlatformTarget[] }
export interface PublishRequest {
  credential: PlatformCredential;
  target: PlatformTarget;
  text: string;
  link?: string | null;
}
export interface PublishResult { remoteId: string; url: string | null }
export interface RemoteStatusRequest { credential: PlatformCredential; remoteId: string }
export interface RemoteStatus { state: 'published' | 'scheduled' | 'unknown'; publishedAt?: Date | null }
export interface RemoteDeleteRequest { credential: PlatformCredential; remoteId: string }
export interface InboxRequest { credential: PlatformCredential; targetId: string }
export interface InboxItem { id: string; text: string; createdAt: Date }
export interface AnalyticsRequest { credential: PlatformCredential; targetId: string; since?: Date; until?: Date }
export interface AnalyticsResult { metrics: Record<string, number | null> }
export interface AdsRequest { credential: PlatformCredential; accountId: string }
export interface AdsResult { items: unknown[] }

/** Optional members are intentionally absent when the provider slice does not implement them. */
export interface PlatformAdapter {
  readonly id: string;
  readonly capabilities: CapabilityDeclaration;
  discover?(request: DiscoveryRequest): Promise<DiscoveryResult>;
  publish?(request: PublishRequest): Promise<PublishResult>;
  getRemoteStatus?(request: RemoteStatusRequest): Promise<RemoteStatus>;
  deleteRemote?(request: RemoteDeleteRequest): Promise<void>;
  listInbox?(request: InboxRequest): Promise<InboxItem[]>;
  getAnalytics?(request: AnalyticsRequest): Promise<AnalyticsResult>;
  listAds?(request: AdsRequest): Promise<AdsResult>;
}
