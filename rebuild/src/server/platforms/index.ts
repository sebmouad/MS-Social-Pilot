import type { NextRequest, NextResponse } from 'next/server';
import type { PlatformId } from '@/platforms';
import type { PlatformAdapter } from '@/platforms/types';
import { configuredFacebookAdapter, configuredFacebookOAuth } from './facebook';
import { finishFacebookConnection, startFacebookConnection } from './facebook-connect';
import { syncAdsAnalytics, syncInbox, syncPageAnalytics, syncScheduledPostStatus } from '@/platforms/facebook/jobs';
import type { PlatformJobName, JobSummary } from '@/server/jobs/types';
import type { RetryBackoff } from '@/server/jobs/retry';

/** The viewer fields a connection flow needs; the routes check role and access first. */
export interface ConnectionViewer {
  user: { id: string };
  workspaceId: string;
}

/** Server wiring of one installed platform module. */
export interface PlatformHost {
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
