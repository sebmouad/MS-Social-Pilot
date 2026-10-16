import type { PlatformHost } from '@/server/platforms/host';
import { configuredFacebookAdapter, configuredFacebookOAuth } from './runtime';
import { finishFacebookConnection, startFacebookConnection } from './connection';
import { facebookAdsHost } from './ads';
import { facebookAnalyticsHost } from './analytics';
import { facebookReplyPolicy, canManageFacebookInbox, syncFacebookInbox, replyToFacebookInbox, setFacebookInboxResolved, moderateFacebookComment, deleteFacebookComment } from './inbox';
import { syncAdsAnalytics, syncInbox, syncPageAnalytics, syncScheduledPostStatus } from './jobs';

/** Facebook-owned assembly; shared registration knows only the host contract. */
export const facebookHost = {
  adapter: configuredFacebookAdapter,
  ads: facebookAdsHost,
  analytics: facebookAnalyticsHost,
  inbox: { replyPolicy: facebookReplyPolicy, canManage: canManageFacebookInbox, sync: syncFacebookInbox, reply: replyToFacebookInbox, resolve: setFacebookInboxResolved, moderate: moderateFacebookComment, deleteComment: deleteFacebookComment },
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
} satisfies PlatformHost;
