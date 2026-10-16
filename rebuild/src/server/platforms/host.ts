import type { NextRequest, NextResponse } from 'next/server';
import type { PlatformAdapter, AdMutationRequest, AdObjectReadRequest, PlatformCredential } from '@/platforms/types';
import type { PlatformJobName, JobSummary } from '@/server/jobs/types';
import type { RetryBackoff } from '@/server/jobs/retry';
import type { InboxActor } from '@/server/inbox/actions';
import type { AnalyticsProviderData, AnalyticsProviderRequest } from '@/server/analytics/catalog';
import type { InboxReplyPolicyRequest } from '@/server/inbox/policy';
import type { ReplyRule } from '@/server/inbox/threads';
import type { AdsUiSchema } from '@/platforms/ads-ui';

export interface PlatformAnalyticsHost {
  load(request: AnalyticsProviderRequest): Promise<AnalyticsProviderData>;
}

export interface PlatformAdsHost {
  /** Safe, serializable UI configuration; never contains credentials or server functions. */
  ui: AdsUiSchema;
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
  resolve(actor: InboxActor, input: { kind: 'message' | 'comment'; id: string; resolved: boolean }): Promise<{ ok: boolean }>;
  moderate(actor: InboxActor, input: { id: string; hidden: boolean }): Promise<{ ok: boolean }>;
  deleteComment(actor: InboxActor, input: { id: string }): Promise<{ ok: boolean }>;
}

export interface PlatformHost {
  diagnostics?: import('@/server/diagnostics/types').PlatformDiagnostics;
  inbox?: PlatformInboxHost;
  ads?: PlatformAdsHost;
  analytics?: PlatformAnalyticsHost;
  /** Build the engine from Root settings. */
  adapter(): Promise<PlatformAdapter>;
  jobs?: Partial<Record<PlatformJobName, (now: Date, retryLimit: number, retryBackoff: RetryBackoff) => Promise<JobSummary>>>;
  connection: {
    /** True when Root has filled in what a customer needs to connect. */
    isReady(): Promise<boolean>;
    start(request: Request, viewer: ConnectionViewer): Promise<NextResponse>;
    callback(request: NextRequest, viewer: ConnectionViewer): Promise<NextResponse>;
  };
}

