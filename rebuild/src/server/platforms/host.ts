import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextRequest, NextResponse } from 'next/server';
import type { PlatformAdapter, AdMutationRequest, AdObjectReadRequest, PlatformCredential } from '@/platforms/types';
import type { PlatformJobName, JobSummary } from '@/server/jobs/types';
import type { RetryBackoff } from '@/server/jobs/retry';
import type { InboxActor } from '@/modules/inbox/server/actions';
import type { AnalyticsProviderData, AnalyticsProviderRequest } from '@/modules/analytics/server/catalog';
import type { InboxReplyPolicyRequest } from '@/modules/inbox/server/policy';
import type { ReplyRule } from '@/modules/inbox/server/threads';
import type { AdsUiSchema } from '@/platforms/ads-ui';
import type { AdsOpsHost } from '@/modules/ads/management/types';
import type { Prisma } from '../../../generated/client';

/** Fixed wire-integrity bound for content-free operator evidence cells. */
export const PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT = 2048;

export interface PlatformPublicationEvidence {
  title: string;
  description: string;
  columns: Array<{ key: string; label: string }>;
  /** Optional compact table columns; all fields remain in row details. */
  summaryColumnKeys?: string[];
  items: Array<Record<string, string | number | null>>;
  truncated: boolean;
  /** Module-owned actions refer only to rows included in this evidence panel. */
  rowIdKey?: string;
  actions?: PlatformPublicationAction[];
}

export interface PlatformPublicationAction {
  /** Module-owned emphasis; inspections reuse the shared neutral button variant. */
  intent?: 'inspect' | 'change' | 'delete';
  rowId: string;
  actionId: string;
  subjectId: string;
  label: string;
  description: string;
  acknowledgmentLabel: string;
  confirmation: string;
  /** Optional read-only context derived by the module from resolved evidence. */
  context?: Array<{ label: string; value: string }>;
  /** Optional, module-owned form fields used to record human observations. */
  fields?: PlatformPublicationActionField[];
}

export interface PlatformPublicationActionField {
  key: string;
  label: string;
  kind: 'text' | 'choice' | 'checkbox';
  required: boolean;
  description?: string;
  /** Text field length only; semantic validation remains module-owned. */
  maxLength?: number;
  /** Choice fields only; values are opaque and interpreted by the module. */
  options?: Array<{ value: string; label: string }>;
}

export interface PlatformPublicationActionInput {
  actionId: string;
  subjectId: string;
  confirmation: string;
  acknowledged: true;
  fieldValues?: Record<string, string | boolean>;
}

export interface PlatformPublicationActionResult {
  ok: boolean;
  actionId: string;
  subjectId: string;
  operationId: string;
  state: 'confirmed' | 'attested' | 'rejected' | 'needs_review';
  message: string;
}

/** Installed module safety hooks remain active even while customer access is off. */
export interface PlatformPublicationRecovery {
  assertSettled(tx: Prisma.TransactionClient, workspaceId: string, targetIds?: readonly string[]): Promise<void>;
  assertOutcome(tx: Prisma.TransactionClient, workspaceId: string, operationId: string, outcome: 'PUBLISHED' | 'ABSENT', remotePostId?: string): Promise<void>;
  /** Trusted Root-only caller; module returns content/credential-free evidence. */
  readEvidence(operationId?: string, resultCap?: number): Promise<PlatformPublicationEvidence>;
  executeRootAction?(userId: string, input: PlatformPublicationActionInput): Promise<PlatformPublicationActionResult>;
}

/** One published post on one channel, with module-normalized stored measures. Missing measures are null, never zero. */
export type PostPerformance = {
  postId: string; text: string; publishedAt: Date | null; url: string | null;
  measures: Array<{ key: string; label: string; labelFr?: string; value: number | null }>;
  /** The module's ranking measure for this post (null when unknown) and its customer label. */
  rankValue: number | null; rankLabel: string;
  measuredAt: Date | null;
};

/** Channel totals over one window that monthly goals track, from stored data. Null means not stored, never zero. */
export type GoalMeasures = {
  audienceGained: number | null; views: number | null; engagements: number | null;
  /**
   * Where each views/engagements figure came from. `page-daily` is a sum of daily channel flows; `post-cohort` is the sum of
   * lifetime snapshots of posts published in the window. They are different quantities and a caller must not add or compare
   * them with each other. Absent means every figure is `page-daily` (older adapters).
   */
  basis?: { views: GoalBasis | null; engagements: GoalBasis | null };
  /** For `post-cohort` figures: posts in the window, and whether the bounded read dropped some. */
  cohort?: { posts: number; truncated: boolean };
};
export type GoalBasis = 'page-daily' | 'post-cohort';

/** Stored per-post measures summed over one channel's posts published in a window. `measuredPosts` is how many posts had that measure stored; null value means none did (unknown, never zero). */
export type DestinationMeasures = {
  measures: Array<{ key: string; label: string; value: number | null; measuredPosts: number }>;
  /** Posts in the cohort (each remote post counted once) and whether the bounded read dropped some. */
  coverage?: { posts: number; truncated: boolean };
};

export type PostPerformanceRequest = { workspaceId: string; targetId: string; from: Date; to: Date; limit: number; offset?: number; sort?: string; direction?: 'asc' | 'desc' };

export interface PlatformAnalyticsHost {
  load(request: AnalyticsProviderRequest): Promise<AnalyticsProviderData>;
  /** Optional: precompute one daily value per channel/metric from stored insights. No provider request. */
  rollups?: {
    computeDaily(input: { workspaceId: string; targetIds: readonly string[]; from: Date; to: Date }): Promise<ChannelRollupRow[]>;
  };
  /** Stored measures for an authorized channel. Explicit sort uses unknown-last ordering and postId ties; omitted sort retains provider ranking. No provider request. */
  postPerformance?(request: PostPerformanceRequest): Promise<PostPerformance[]>;
  /** Optional: stored per-post measures summed for one already-authorized channel over [from, to). No provider request. */
  destinationMeasures?(request: { workspaceId: string; targetId: string; from: Date; to: Date }): Promise<DestinationMeasures>;
  /** Optional: goal measures for one already-authorized channel over [from, to). No provider request. */
  goalMeasures?(request: { workspaceId: string; targetId: string; from: Date; to: Date }): Promise<GoalMeasures>;
}

export interface PlatformAdsHost {
  /** Optional complete object-management engine owned by this platform. */
  operations?: AdsOpsHost;
  /** Resolve Root-managed customer copy for this request; failures must never fall back to a static engine. */
  configuredOperations?(locale: 'en' | 'fr'): Promise<AdsOpsHost>;
  /** Pure interpretation of provider-owned stored fields; no credentials or network requests. */
  parentObjectId?(input: { level: 'campaign' | 'adset' | 'ad'; fields: unknown }): string | null;
  /** Safe, serializable UI configuration; never contains credentials or server functions. */
  ui: AdsUiSchema;
  /** Root-managed safe creation choices and copy, when supported by the installed module. */
  creationUi?(): Promise<AdsUiSchema>;
  /** Whether current Root configuration can support this module's live Ads requests. */
  isReady?(): Promise<boolean>;
  readScopes(): Promise<string[]>;
  manageScopes(): Promise<string[]>;
  hasReadScopes(required: readonly string[], granted: readonly string[]): boolean;
  validateManageScopes(required: readonly string[], granted: readonly string[]): void;
  validateCampaign(name: string, objective: string): void;
  campaignConfirmation(adAccountId: string, name: string, objective: string): string;
  validateAdSet(input: { name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }): void;
  adSetConfirmation(input: { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }): string;
  read(input: AdObjectReadRequest): Promise<unknown>;
  update(input: AdMutationRequest): Promise<void>;
  createCampaign(input: { credential: PlatformCredential; accountId: string; name: string; objective: string }): Promise<{ remoteId: string }>;
  createAdSet(input: { credential: PlatformCredential; accountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }): Promise<{ remoteId: string }>;
}

/** The viewer fields a connection flow needs; the routes check role and access first. */
export interface ConnectionViewer {
  user: { id: string };
  workspaceId: string;
}

/** Server wiring of one installed platform module. */
export interface PlatformInboxHost {
  replyPolicy(input: InboxReplyPolicyRequest): Promise<ReplyRule>;
  canManage(actor: InboxActor, targetId: string): Promise<boolean>;
  sync(actor: InboxActor, targetId?: string): Promise<{ targetCount: number; failedCount: number; conversationCount: number; messageCount: number; commentCount: number; syncedAt: string }>;
  reply(actor: InboxActor, input: { kind: 'message' | 'comment'; id: string; text: string }): Promise<{ ok: boolean }>;
  moderate(actor: InboxActor, input: { id: string; hidden: boolean }): Promise<{ ok: boolean }>;
  prepareDeleteComment(actor: InboxActor, input: { targetId: string; remoteId: string }): Promise<(signal: AbortSignal) => Promise<void>>;
  /** Optional read-only worker check for an uncertain deletion. `absent` is positive evidence the module's own rules accept; `present` and `unknown` keep the deletion held. Never writes remotely. */
  readCommentPresence?(input: { workspaceId: string; targetId: string; remoteId: string; postRemoteId: string }, signal: AbortSignal): Promise<'present' | 'absent' | 'unknown'>;
  /** Optional: present only when the module reads public reviews. `reply` is present only when the provider lets a channel answer one. */
  reviews?: {
    sync(actor: InboxActor, targetId?: string): Promise<{ targetCount: number; failedCount: number; reviewCount: number; syncedAt: string }>;
    reply?(actor: InboxActor, input: { id: string; text: string }): Promise<{ ok: boolean }>;
  };
}

/** Outcome of a provider's server-to-server deauthorize / data-deletion callback. */
export type PlatformDataCallbackResult =
  | { ok: true; affected: number; confirmationCode?: string }
  | { ok: false; reason: 'invalid_signature' };

export interface PlatformLinkCard { title: string | null; description: string | null; imageUrl: string | null; siteName: string | null }
export interface PlatformLinkPreviewHost { refresh(url: string, signal: AbortSignal): Promise<PlatformLinkCard | null> }

/** One provider-to-app event delivery receipt. Content-free: kinds and counts only, never message text. */
export interface PlatformWebhookDelivery {
  id: string; receivedAt: Date; pageId: string;
  eventKind: 'feed_post' | 'feed_comment' | 'message' | 'unknown';
  status: 'accepted' | 'duplicate' | 'unmatched' | 'ignored';
  matchedTargets: number;
  detail: { verb?: string; written?: number; reason?: string; errors?: string[] };
}

/** Module-worded labels for the shared Root webhook-deliveries panel. */
export interface PlatformWebhookDeliveriesCopy {
  title: string; intro: string; empty: string; unavailable: string;
  received: string; page: string; kind: string; status: string; targets: string; detail: string;
  kinds: Record<PlatformWebhookDelivery['eventKind'], string>;
  statuses: Record<PlatformWebhookDelivery['status'], string>;
  written: string; verb: string; disabled: string; unknownEvent: string;
}

/** Provider-owned inbound webhooks: verification handshake, signed ingestion and diagnostics. */
export interface PlatformWebhooksHost {
  /** Provider verification handshake (Meta's hub.mode challenge). Never stores. */
  verifySubscription(query: { mode: string | null; token: string | null; challenge: string | null }): Promise<{ ok: boolean; challenge?: string }>;
  /** Verify the provider signature and idempotently ingest one raw delivery. No provider request. */
  ingest(rawBody: string, signature: string | null, now?: Date): Promise<{ received: number; accepted: number; duplicates: number; unmatched: number; ignored: number }>;
  /** Recent delivery receipts for Root diagnostics, newest first. */
  readDeliveries(limit: number): Promise<PlatformWebhookDelivery[]>;
  /** Module-owned panel labels in the requested locale. */
  copy(locale: 'en' | 'fr'): Promise<PlatformWebhookDeliveriesCopy>;
}

/** One precomputed daily channel value: latest observation per day for stocks, sum of the day for flows. */
export interface ChannelRollupRow {
  targetId: string; metric: string; period: string; day: string;
  kind: 'flow' | 'stock'; value: number; samples: number; asOf: Date; fetchedAt: Date;
}

/** One provider throttling scope with the latest value the provider reported; never a quota guarantee. */
export interface PlatformApiUsageScope {
  scope: string;
  label: string;
  capturedAt: string;
  /** True when the reading is older than the module's freshness bound. */
  stale: boolean;
  metrics: Array<{ key: string; label: string; value: number; unit: 'percent' | 'seconds' | 'minutes'; warning: boolean }>;
}

/** Module-worded form for providers connected by entering a credential (app password, bot token) instead of an OAuth redirect. */
export interface PlatformCredentialForm {
  title: string;
  intro: string;
  submit: string;
  fields: Array<{ key: string; label: string; help?: string; secret: boolean; maxLength: number }>;
}

export interface PlatformHost {
  /** Optional: latest provider-reported API usage (rate-limit) readings, read by Root. */
  apiUsage?: { read(limit: number, locale: 'en' | 'fr'): Promise<PlatformApiUsageScope[]> };
  diagnostics?: import('@/server/diagnostics/types').PlatformDiagnostics;
  inbox?: PlatformInboxHost;
  ads?: PlatformAdsHost;
  analytics?: PlatformAnalyticsHost;
  /** Optional: ask the provider to read a public page again so its cached link card is fresh. Null when it found nothing usable. */
  linkPreview?: PlatformLinkPreviewHost;
  /** Build the engine from Root settings. */
  adapter(): Promise<PlatformAdapter>;
  jobs?: Partial<Record<PlatformJobName, (now: Date, retryLimit: number, retryBackoff: RetryBackoff) => Promise<JobSummary>>>;
  /** Optional provider-owned inbound webhooks (verification, signed ingestion, diagnostics). */
  webhooks?: PlatformWebhooksHost;
  /** Provider-signed callbacks for access removal and data erasure; the module verifies the provider's signature. */
  dataCallbacks?: {
    deauthorize(signedRequest: string): Promise<PlatformDataCallbackResult>;
    dataDeletion(signedRequest: string): Promise<PlatformDataCallbackResult>;
  };
  connection: {
    /**
     * Credential-entry connection (no redirect). The module validates the credential with its provider and
     * returns the account and destinations; the shared Settings service owns authorization, confirmation,
     * encrypted persistence and audit. When present, `start`/`callback` are not used for this module.
     */
    credentials?: {
      form(locale: 'en' | 'fr'): Promise<PlatformCredentialForm>;
      connect(fields: Record<string, string>, signal?: AbortSignal): Promise<import('./token-connection').TokenConnectionResult>;
    };
    /**
     * Server-only renewal; null means this credential cannot be renewed. No persistence or UI data.
     * `expiresAt` is the renewed access token's end (also the grant end when the connection has no
     * refresh token). `grantExpiresAt`, when present, is a separately reported grant end and is the
     * only value Root stores as the grant expiry. `rotateDestinationCopies` is true when this module
     * stores copies of the account token on its destinations; Root then rotates those copies in the
     * same transaction. Modules with channel-specific destination credentials leave it unset.
     */
    renewToken?(input: { accessToken: string; refreshToken: string | null; signal: AbortSignal }): Promise<{ accessToken: string; expiresAt: Date | null; refreshToken?: string | null; grantExpiresAt?: Date | null; rotateDestinationCopies?: boolean } | null>;
    /** True when Root has filled in what a customer needs to connect. */
    isReady(): Promise<boolean>;
    start(request: Request, viewer: ConnectionViewer): Promise<NextResponse>;
    callback(request: NextRequest, viewer: ConnectionViewer): Promise<NextResponse>;
    /** Customer-worded permission areas (granted/missing/unknown) from grants recorded at connection time. */
    grantHealth?(input: { scopes: string | null | undefined; hasAdAccounts: boolean; locale?: 'en' | 'fr' }): Promise<import('@/lib/connection-health').GrantGroupHealth[]>;
  };
}



export type PlatformAdsLocale = 'en' | 'fr';
const locales = new AsyncLocalStorage<PlatformAdsLocale>();

/** Transport-independent locale scope shared by nested Ads service calls. */
export function withPlatformAdsLocale<T>(locale: PlatformAdsLocale, operation: () => Promise<T>): Promise<T> {
  return locales.run(locale, operation);
}

export function platformAdsLocale(): PlatformAdsLocale {
  return locales.getStore() ?? 'en';
}
