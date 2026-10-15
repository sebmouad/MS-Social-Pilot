import type { NextRequest, NextResponse } from 'next/server';
import type { PlatformId } from '@/platforms';
import type { PlatformAdapter } from '@/platforms/types';
import { configuredFacebookAdapter, configuredFacebookOAuth } from './facebook';
import { finishFacebookConnection, startFacebookConnection } from './facebook-connect';
import { facebookAdsHost } from '@/platforms/facebook/ads';
import { canManageFacebookInbox, syncFacebookInbox, replyToFacebookInbox, setFacebookInboxResolved, moderateFacebookComment, deleteFacebookComment } from '@/platforms/facebook/inbox';
import { syncAdsAnalytics, syncInbox, syncPageAnalytics, syncScheduledPostStatus } from '@/platforms/facebook/jobs';
import type { PlatformJobName, JobSummary } from '@/server/jobs/types';
import type { RetryBackoff } from '@/server/jobs/retry';
import type { InboxActor } from '@/server/inbox/actions';
import type { AdMutationRequest, AdObjectReadRequest, PlatformCredential } from '@/platforms/types';
import type { AdsUiSchema } from '@/platforms/ads-ui';

export interface PlatformAdsHost {
  /** Safe creation metadata; provider credentials and functions never reach the browser. */
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
  canManage(actor: InboxActor, targetId: string): Promise<boolean>;
  sync(actor: InboxActor, targetId?: string): Promise<{ targetCount: number; failedCount: number; conversationCount: number; messageCount: number; commentCount: number; syncedAt: string }>;
  reply(actor: InboxActor, input: { kind: 'message' | 'comment'; id: string; text: string }): Promise<{ ok: boolean }>;
  resolve(actor: InboxActor, input: { kind: 'message' | 'comment'; id: string; resolved: boolean }): Promise<{ ok: boolean }>;
  moderate(actor: InboxActor, input: { id: string; hidden: boolean }): Promise<{ ok: boolean }>;
  deleteComment(actor: InboxActor, input: { id: string }): Promise<{ ok: boolean }>;
}

export interface PlatformHost {
  inbox?: PlatformInboxHost;
  ads?: PlatformAdsHost;
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

/** One entry per module in `src/platforms/index.ts`; the type keeps the two lists in step. */
export const PLATFORM_HOSTS: Readonly<Record<PlatformId, PlatformHost>> = {
  facebook: {
    adapter: configuredFacebookAdapter,
    ads: facebookAdsHost,
    inbox: { canManage: canManageFacebookInbox, sync: syncFacebookInbox, reply: replyToFacebookInbox, resolve: setFacebookInboxResolved, moderate: moderateFacebookComment, deleteComment: deleteFacebookComment },
    connection: {
      isReady: () => configuredFacebookOAuth().then(() => true, () => false),
      start: startFacebookConnection,
      callback: finishFacebookConnection,
    },
    jobs: {
      posts: syncScheduledPostStatus,
      analytics: async (now, retryLimit, retryBackoff) => {
        const page = await syncPageAnalytics(now, retryLimit, retryBackoff);
        const ads = await syncAdsAnalytics(now, retryLimit, retryBackoff);
        return { examined: page.examined + ads.examined, updated: page.updated + ads.updated, skipped: page.skipped + ads.skipped, failed: page.failed + ads.failed };
      },
      inbox: syncInbox,
    },
  },
};
