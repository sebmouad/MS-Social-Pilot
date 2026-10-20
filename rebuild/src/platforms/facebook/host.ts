import { facebookDiagnostics } from './diagnostics';
import type { PlatformHost } from '@/server/platforms/host';
import { configuredFacebookAdapter, configuredFacebookOAuth } from './runtime';
import { facebookGrantHealth } from './connection-health';
import { finishFacebookConnection, startFacebookConnection } from './connection';
import { facebookAdsHost } from './ads';
import { facebookAdsOps } from './ads-ops';
import { facebookAnalyticsHost } from './analytics';
import { facebookReplyPolicy, canManageFacebookInbox, syncFacebookInbox, replyToFacebookInbox, moderateFacebookComment, prepareDeleteFacebookComment, readFacebookCommentPresence, syncFacebookReviews } from './inbox';
import { syncAdsAnalytics, syncInbox, syncPageAnalytics, syncScheduledPostStatus } from './jobs';
import { syncFacebookSubmittedPosts } from './submitted-jobs';

async function syncFacebookPosts(now?: Date, retryLimit?: number, retryBackoff?: Parameters<typeof syncScheduledPostStatus>[2]) {
  const scheduled = await syncScheduledPostStatus(now, retryLimit, retryBackoff);
  const submitted = await syncFacebookSubmittedPosts(now, retryLimit, retryBackoff);
  return { examined: scheduled.examined + submitted.examined, updated: scheduled.updated + submitted.updated, skipped: scheduled.skipped + submitted.skipped, failed: scheduled.failed + submitted.failed };
}

/** Facebook-owned assembly; shared registration knows only the host contract. */
export const facebookHost = {
  adapter: configuredFacebookAdapter,
  diagnostics: facebookDiagnostics,
  ads: { ...facebookAdsHost, operations: facebookAdsOps },
  analytics: facebookAnalyticsHost,
  inbox: { replyPolicy: facebookReplyPolicy, canManage: canManageFacebookInbox, sync: syncFacebookInbox, reply: replyToFacebookInbox, moderate: moderateFacebookComment, prepareDeleteComment: prepareDeleteFacebookComment, readCommentPresence: readFacebookCommentPresence, reviews: { sync: syncFacebookReviews } },
  connection: {
    isReady: () => configuredFacebookOAuth().then(() => true, () => false),
    start: startFacebookConnection,
    callback: finishFacebookConnection,
    grantHealth: facebookGrantHealth,
  },
  jobs: {
    posts: syncFacebookPosts,
    analytics: async (now, retryLimit, retryBackoff) => {
      const page = await syncPageAnalytics(now, retryLimit, retryBackoff);
      const ads = await syncAdsAnalytics(now, retryLimit, retryBackoff);
      return { examined: page.examined + ads.examined, updated: page.updated + ads.updated, skipped: page.skipped + ads.skipped, failed: page.failed + ads.failed };
    },
    inbox: syncInbox,
  },
} satisfies PlatformHost;
