import { createHmac, randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { Prisma } from '../../../../generated/client';

export interface SyncedPostMetricResult {
  postTargetId: string;
  targetId: string;
  remotePostId: string;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  views: number;
  clicks: number;
  permalink: string | null;
  syncedAt: Date;
}

/**
 * Real-time on-demand post metrics sync directly from the platform APIs (Facebook, Instagram, etc.).
 * Updates post_targets.insights, post_targets.insightsSyncedAt, post_targets.remoteUrl,
 * and external_posts so all views across the application reflect the latest real data.
 */
export async function syncPostMetrics(workspaceId: string, postId: string): Promise<SyncedPostMetricResult[]> {
  // Same Graph version as the rest of the Meta integration; a pinned old version stops working when Meta retires it.
  const graphVersion = String(await runtimeConfig('meta.graphVersion'));
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      message: true,
      targets: {
        where: { status: 'published', remotePostId: { not: null } },
        select: {
          id: true,
          targetId: true,
          remotePostId: true,
          remoteUrl: true,
          target: {
            select: {
              id: true,
              type: true,
              name: true,
              providerId: true,
              accessToken: true,
              socialAccount: {
                select: {
                  id: true,
                  provider: true,
                  accessToken: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!post || !post.targets.length) {
    return [];
  }

  const results: SyncedPostMetricResult[] = [];
  const now = new Date();

  for (const pt of post.targets) {
    if (!pt.remotePostId) continue;

    const provider = pt.target.socialAccount?.provider ?? 'facebook';
    const encryptedToken = pt.target.accessToken ?? pt.target.socialAccount?.accessToken;
    if (!encryptedToken) continue;

    try {
      const token = decryptSecret(encryptedToken);

      if (provider === 'facebook') {
        const secret = await runtimeSecret('meta.appSecret').catch(() => null);
        const proof = secret ? createHmac('sha256', secret).update(token).digest('hex') : null;
        const proofParam = proof ? `&appsecret_proof=${proof}` : '';

        // 1. Fetch basic post fields (reactions, comments, shares, permalink)
        const basicUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pt.remotePostId)}?fields=shares,comments.summary(true),reactions.summary(true),permalink_url&access_token=${encodeURIComponent(token)}${proofParam}`;
        const basicRes = await fetch(basicUrl, { signal: AbortSignal.timeout(10000) });
        const basicData = await basicRes.json().catch(() => ({}));

        if (basicData.error) {
          console.warn(`[syncPostMetrics] Facebook error for ${pt.remotePostId}:`, basicData.error.message);
          continue;
        }

        const likes = typeof basicData.reactions?.summary?.total_count === 'number' ? basicData.reactions.summary.total_count : 0;
        const comments = typeof basicData.comments?.summary?.total_count === 'number' ? basicData.comments.summary.total_count : 0;
        const shares = typeof basicData.shares?.count === 'number' ? basicData.shares.count : 0;
        const permalink = typeof basicData.permalink_url === 'string' ? basicData.permalink_url : pt.remoteUrl;

        // 2. Fetch post insights (post_media_view, post_total_media_view_unique, post_clicks, post_reactions_by_type_total)
        let reach = 0;
        let views = 0;
        let clicks = 0;
        const insightsMap: Record<string, unknown> = {
          reactions: likes,
          reactions_like: likes,
          comments,
          shares,
          clicks: 0,
        };

        const insUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pt.remotePostId)}/insights?metric=post_media_view,post_total_media_view_unique,post_clicks,post_reactions_by_type_total&period=lifetime&access_token=${encodeURIComponent(token)}${proofParam}`;
        try {
          const insRes = await fetch(insUrl, { signal: AbortSignal.timeout(10000) });
          const insData = await insRes.json();
          if (Array.isArray(insData.data)) {
            for (const item of insData.data) {
              const val = item.values?.[0]?.value;
              if (item.name === 'post_total_media_view_unique' && typeof val === 'number') {
                reach = val;
                insightsMap.post_total_media_view_unique = val;
                insightsMap.reach = val;
              } else if (item.name === 'post_media_view' && typeof val === 'number') {
                views = val;
                insightsMap.post_media_view = val;
                insightsMap.views = val;
              } else if (item.name === 'post_clicks' && typeof val === 'number') {
                clicks = val;
                insightsMap.clicks = val;
                insightsMap.post_clicks = val;
              } else if (item.name === 'post_reactions_by_type_total' && typeof val === 'object' && val !== null) {
                insightsMap.post_reactions_by_type_total = val;
              }
            }
          }
        } catch {
          // Insights failure is non-fatal; counts from basic Data persist
        }

        // If reach is 0 but views exist, fallback reach to views
        if (reach === 0 && views > 0) reach = views;

        // 3. Persist to post_targets
        await prisma.$executeRaw`
          UPDATE post_targets
          SET "remoteUrl" = COALESCE(${permalink}, "remoteUrl"),
              insights = ${JSON.stringify(insightsMap)}::jsonb,
              "insightsSyncedAt" = ${now}
          WHERE id = ${pt.id}
        `;

        // 4. Upsert to external_posts
        await prisma.$executeRaw`
          INSERT INTO external_posts (id, "targetId", "remoteId", message, permalink, "statusType", "createdTime", insights, "insightsSyncedAt", "fetchedAt")
          VALUES (${`fb_${randomUUID()}`}, ${pt.targetId}, ${pt.remotePostId}, ${post.message ?? ''}, ${permalink}, 'status', ${now}, ${JSON.stringify(insightsMap)}::jsonb, ${now}, ${now})
          ON CONFLICT ("targetId", "remoteId") DO UPDATE SET
            permalink = COALESCE(EXCLUDED.permalink, external_posts.permalink),
            insights = EXCLUDED.insights,
            "insightsSyncedAt" = EXCLUDED."insightsSyncedAt",
            "fetchedAt" = EXCLUDED."fetchedAt"
        `;

        results.push({
          postTargetId: pt.id,
          targetId: pt.targetId,
          remotePostId: pt.remotePostId,
          likes,
          comments,
          shares,
          reach,
          views,
          clicks,
          permalink,
          syncedAt: now,
        });
      } else if (provider === 'instagram') {
        // Instagram Graph API post metrics
        const insUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pt.remotePostId)}?fields=like_count,comments_count,permalink,insights.metric(reach,views,saved)&access_token=${encodeURIComponent(token)}`;
        const insRes = await fetch(insUrl, { signal: AbortSignal.timeout(10000) });
        const data = await insRes.json().catch(() => ({}));
        if (!data.error) {
          const likes = typeof data.like_count === 'number' ? data.like_count : 0;
          const comments = typeof data.comments_count === 'number' ? data.comments_count : 0;
          const permalink = typeof data.permalink === 'string' ? data.permalink : pt.remoteUrl;
          let reach = 0;
          let views = 0;
          if (Array.isArray(data.insights?.data)) {
            for (const item of data.insights.data) {
              const val = item.values?.[0]?.value;
              if (item.name === 'reach' && typeof val === 'number') reach = val;
              if (item.name === 'views' && typeof val === 'number') views = val; // Meta replaced media impressions with views (v22)
            }
          }
          const insightsMap = { likes, likeCount: likes, comments, commentsCount: comments, reach, views, impressions: views };
          await prisma.$executeRaw`
            UPDATE post_targets
            SET "remoteUrl" = COALESCE(${permalink}, "remoteUrl"),
                insights = ${JSON.stringify(insightsMap)}::jsonb,
                "insightsSyncedAt" = ${now}
            WHERE id = ${pt.id}
          `;
          results.push({
            postTargetId: pt.id,
            targetId: pt.targetId,
            remotePostId: pt.remotePostId,
            likes,
            comments,
            shares: 0,
            reach,
            views,
            clicks: 0,
            permalink,
            syncedAt: now,
          });
        }
      }
    } catch (err) {
      console.warn(`[syncPostMetrics] Failed for target ${pt.targetId}:`, err);
    }
  }

  return results;
}
