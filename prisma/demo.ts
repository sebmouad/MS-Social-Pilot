/**
 * Demo analytics: two invented Pages with six months of history.
 *
 * Every analytics and ads screen is a view over data that only a real Facebook Page can
 * produce, so on a fresh installation — or a developer's laptop — they are all
 * empty states. This fills one workspace with enough invented history to see
 * them working: daily Page figures, posts of every format with their insights,
 * and patterns worth finding (a better time of day, a format that outperforms,
 * a quiet fortnight, a slow rise in followers).
 *
 * Nothing here is real and nothing can be published: the Pages' tokens are
 * placeholders, and their ids start with `demo-` so a re-run replaces them.
 *
 *   npm run db:demo                       # the demo seed's workspace
 *   npm run db:demo -- "Client name"      # a workspace of your own, by name
 *
 * Deterministic — a seeded generator, not Math.random — so two runs, and two
 * screenshots, show the same numbers.
 */

import { Prisma, PrismaClient, PostStatus, PostTargetStatus, TargetType } from '@prisma/client';

import { encryptSecret } from '../src/lib/crypto';

const prisma = new PrismaClient();

const DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/** mulberry32: small, fast, and the same sequence for the same seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Format = 'photo' | 'video' | 'link' | 'text';

const STATUS_TYPE: Record<Format, string> = {
  photo: 'added_photos',
  video: 'added_video',
  link: 'shared_story',
  text: 'mobile_status_update',
};

const MESSAGES: Record<Format, string[]> = {
  photo: [
    'Fresh out of the oven this morning.',
    'Behind the counter: meet the team.',
    'This week’s special, photographed before it sold out.',
    'Saturday market stall is up.',
  ],
  video: [
    'Sixty seconds of how we shape a loaf.',
    'Watch the first batch of the day come out.',
    'A quick tour of the new kitchen.',
  ],
  link: [
    'Our story in the local paper.',
    'New on the blog: five things to do with a stale baguette.',
    'Holiday opening hours are on the website.',
  ],
  text: [
    'Closed Monday for a family wedding. Back Tuesday!',
    'What should next month’s special be? Tell us below.',
    'Thank you for a record week.',
  ],
};

interface PageSpec {
  providerId: string;
  name: string;
  category: string;
  fans: number;
  /** Posts per week, on average. */
  cadence: number;
  /** The weekday (0 = Sunday) and hour posts do best at. */
  sweetSpot: { weekday: number; hour: number };
  /** Interactions multiplier per format. */
  formatLift: Record<Format, number>;
  seed: number;
}

const PAGES: PageSpec[] = [
  {
    providerId: 'demo-100000000000001',
    name: 'Halloway Bakery',
    category: 'Bakery',
    fans: 4820,
    cadence: 4,
    sweetSpot: { weekday: 2, hour: 18 },
    formatLift: { photo: 1.4, video: 2.1, link: 0.6, text: 0.9 },
    seed: 7,
  },
  {
    providerId: 'demo-100000000000002',
    name: 'Northwind Cycles',
    category: 'Bicycle shop',
    fans: 12650,
    cadence: 2,
    sweetSpot: { weekday: 6, hour: 10 },
    formatLift: { photo: 1.1, video: 1.6, link: 1.0, text: 0.5 },
    seed: 11,
  },
];

function pick<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function pickFormat(random: () => number): Format {
  const roll = random();
  if (roll < 0.45) return 'photo';
  if (roll < 0.65) return 'video';
  if (roll < 0.85) return 'link';
  return 'text';
}

async function seedPage(workspaceId: string, accountId: string, spec: PageSpec, now: Date) {
  const random = generator(spec.seed);

  await prisma.target.deleteMany({ where: { workspaceId, providerId: spec.providerId } });

  const target = await prisma.target.create({
    data: {
      workspaceId,
      socialAccountId: accountId,
      type: TargetType.page,
      providerId: spec.providerId,
      name: spec.name,
      category: spec.category,
      accessToken: encryptSecret('demo-page-token'),
      // Placeholders cannot publish; saying so keeps the composer honest.
      canPublish: false,
      publishBlocker: 'This is a demo Page with invented data. Connect a real Page to publish.',
      fanCount: spec.fans,
      followersCount: Math.round(spec.fans * 1.06),
      talkingAboutCount: Math.round(spec.fans * 0.04),
      profileSyncedAt: now,
      lastSyncedAt: now,
    },
  });

  // --- Posts ---------------------------------------------------------------
  const posts: Prisma.ExternalPostCreateManyInput[] = [];
  const start = now.getTime() - DAYS * DAY_MS;
  // A quiet fortnight about two months ago, which the analysis should notice.
  const quietFrom = now.getTime() - 70 * DAY_MS;
  const quietTo = quietFrom + 14 * DAY_MS;

  for (let day = 0; day < DAYS; day += 1) {
    const dayStart = start + day * DAY_MS;
    if (dayStart >= quietFrom && dayStart < quietTo) continue;
    if (random() > spec.cadence / 7) continue;

    const nearSweetSpot = random() < 0.35;
    const date = new Date(dayStart);
    if (nearSweetSpot) {
      // Move to the sweet-spot weekday within this week.
      const shift = (spec.sweetSpot.weekday - date.getUTCDay() + 7) % 7;
      date.setUTCDate(date.getUTCDate() + shift);
      date.setUTCHours(spec.sweetSpot.hour, Math.floor(random() * 50), 0, 0);
    } else {
      date.setUTCHours(7 + Math.floor(random() * 15), Math.floor(random() * 60), 0, 0);
    }
    if (date.getTime() > now.getTime()) continue;

    const format = pickFormat(random);
    const atSweetSpot =
      date.getUTCDay() === spec.sweetSpot.weekday && Math.abs(date.getUTCHours() - spec.sweetSpot.hour) <= 1;
    // Slow growth over the six months, so the period comparison has a story.
    const growth = 0.75 + (day / DAYS) * 0.5;
    const base = spec.fans * 0.012 * growth * spec.formatLift[format] * (atSweetSpot ? 1.9 : 1);
    const noise = () => 0.6 + random() * 0.8;

    const reactions = Math.round(base * noise());
    const comments = Math.round(base * 0.18 * noise());
    const shares = Math.round(base * (format === 'video' ? 0.2 : 0.08) * noise());
    const reach = Math.round((reactions + comments + shares) * (14 + random() * 10));
    const impressions = Math.round(reach * (1.2 + random() * 0.4));
    const clicks = Math.round(reach * (format === 'link' ? 0.05 : 0.015) * noise());

    posts.push({
      targetId: target.id,
      remoteId: `${spec.providerId}_${day}`,
      message: pick(random, MESSAGES[format]),
      permalink: null,
      statusType: STATUS_TYPE[format],
      createdTime: date,
      insightsSyncedAt: now,
      insights: {
        impressions,
        reach,
        engagedUsers: null,
        reactions,
        comments,
        shares,
        clicks,
        negativeFeedback: Math.round(random() * 3),
        videoViews: format === 'video' ? Math.round(reach * 0.6) : null,
        reactionsByType: {
          like: Math.round(reactions * 0.7),
          love: Math.round(reactions * 0.22),
          wow: Math.round(reactions * 0.05),
          haha: Math.round(reactions * 0.03),
        },
        clicksByType: { 'link clicks': Math.round(clicks * 0.6), 'other clicks': Math.round(clicks * 0.4) },
      },
    });
  }

  await prisma.externalPost.createMany({ data: posts });

  // --- Daily Page figures ------------------------------------------------------
  const insights: Prisma.PageInsightCreateManyInput[] = [];
  let followers = Math.round(spec.fans * 0.9);

  for (let day = 0; day < DAYS; day += 1) {
    const endTime = new Date(start + (day + 1) * DAY_MS);
    endTime.setUTCHours(7, 0, 0, 0);
    const weekend = [0, 6].includes(endTime.getUTCDay());
    const growth = 0.75 + (day / DAYS) * 0.5;

    const reach = Math.round(spec.fans * 0.35 * growth * (weekend ? 0.8 : 1) * (0.7 + random() * 0.6));
    const follows = Math.round(spec.fans * 0.0022 * growth * (0.5 + random()));
    const unfollows = Math.round(spec.fans * 0.0009 * (0.5 + random()));
    followers += follows - unfollows;

    const daily = (metric: string, value: number) =>
      insights.push({ targetId: target.id, metric, period: 'day', endTime, value, numeric: value });

    daily('page_impressions_unique', reach);
    daily('page_impressions', Math.round(reach * 1.5));
    daily('page_post_engagements', Math.round(reach * 0.06 * (0.7 + random() * 0.6)));
    daily('page_views_total', Math.round(reach * 0.03 * (0.7 + random() * 0.6)));
    daily('page_daily_follows_unique', follows);
    daily('page_daily_unfollows_unique', unfollows);
    daily('page_follows', followers);
  }

  const lifetime = (metric: string, value: Record<string, number>) =>
    insights.push({
      targetId: target.id,
      metric,
      period: 'lifetime',
      endTime: now,
      value,
      numeric: null,
    });
  lifetime('page_fans_country', { FR: Math.round(spec.fans * 0.62), BE: Math.round(spec.fans * 0.12), CH: Math.round(spec.fans * 0.08), GB: Math.round(spec.fans * 0.05), MA: Math.round(spec.fans * 0.04) });
  lifetime('page_fans_city', { 'Paris, France': Math.round(spec.fans * 0.31), 'Lyon, France': Math.round(spec.fans * 0.11), 'Brussels, Belgium': Math.round(spec.fans * 0.08) });
  lifetime('page_fans_gender_age', { 'F.25-34': Math.round(spec.fans * 0.21), 'F.35-44': Math.round(spec.fans * 0.17), 'M.25-34': Math.round(spec.fans * 0.15), 'M.35-44': Math.round(spec.fans * 0.12), 'F.18-24': Math.round(spec.fans * 0.08) });

  await prisma.pageInsight.createMany({ data: insights });

  for (const metric of ['page_impressions_unique', 'page_impressions', 'page_post_engagements', 'page_views_total', 'page_daily_follows_unique', 'page_daily_unfollows_unique', 'page_follows']) {
    await prisma.metricAvailability.create({
      data: { targetId: target.id, metric, period: 'day', available: true },
    });
  }

  return { name: spec.name, posts: posts.length, days: DAYS };
}

/**
 * One ad account with three campaigns, each with ad sets and ads, delivering
 * daily for the whole period — at every level, the way a sync stores them.
 *
 * Also with a story: the spring campaign takes most of the budget, the video
 * ads are clicked far more often, and one retargeting ad set pays a lot per
 * click.
 */
async function seedAds(workspaceId: string, accountId: string, now: Date) {
  const random = generator(23);
  const actId = 'act_demo_100000000000001';

  await prisma.adAccount.deleteMany({ where: { workspaceId, actId } });
  const adAccount = await prisma.adAccount.create({
    data: {
      workspaceId,
      socialAccountId: accountId,
      actId,
      name: 'Halloway Bakery — Ads',
      currency: 'EUR',
      accountStatus: 1,
      lastSyncedAt: now,
    },
  });

  const campaigns = [
    { id: 'c1', name: 'Spring menu launch', budget: 38, ctr: 1.4, cpc: 0.42 },
    { id: 'c2', name: 'Weekend brunch — video', budget: 12, ctr: 3.1, cpc: 0.21 },
    { id: 'c3', name: 'Retargeting — website visitors', budget: 9, ctr: 0.8, cpc: 1.05 },
  ];

  const rows: Prisma.AdInsightCreateManyInput[] = [];
  const start = now.getTime() - 120 * DAY_MS;

  for (let day = 0; day < 120; day += 1) {
    const date = new Date(start + day * DAY_MS);
    date.setUTCHours(0, 0, 0, 0);
    // Costs drift down over the period as the campaigns learn.
    const learning = 1.15 - (day / 120) * 0.3;
    const account = { spend: 0, impressions: 0, clicks: 0, reach: 0 };

    for (const campaign of campaigns) {
      const spend = Math.round(campaign.budget * (0.75 + random() * 0.5) * 100) / 100;
      const clicks = Math.max(1, Math.round(spend / (campaign.cpc * learning)));
      const impressions = Math.round((clicks / campaign.ctr) * 100);
      const reach = Math.round(impressions / (1.3 + random() * 0.4));

      const figures = (share: number) => {
        const s = Math.round(spend * share * 100) / 100;
        const c = Math.round(clicks * share);
        const i = Math.round(impressions * share);
        return {
          spend: s,
          clicks: c,
          impressions: i,
          reach: Math.round(reach * share),
          cpc: c > 0 ? Math.round((s / c) * 100) / 100 : null,
          cpm: i > 0 ? Math.round((s / i) * 100000) / 100 : null,
          ctr: i > 0 ? Math.round((c / i) * 10000) / 100 : null,
          actions: {
            actions: [
              { action_type: 'link_click', value: String(Math.round(c * 0.8)) },
              { action_type: 'post_engagement', value: String(Math.round(c * 2.4)) },
              { action_type: 'landing_page_view', value: String(Math.round(c * 0.55)) },
            ],
          },
        };
      };

      rows.push({ adAccountId: adAccount.id, level: 'campaign', objectId: campaign.id, objectName: campaign.name, date, ...figures(1) });
      for (const [index, share] of [0.6, 0.4].entries()) {
        const adset = `${campaign.id}-s${index + 1}`;
        rows.push({ adAccountId: adAccount.id, level: 'adset', objectId: adset, objectName: `${campaign.name} · ${index === 0 ? 'Paris 25–44' : 'Lyon 25–44'}`, date, ...figures(share) });
        for (const [adIndex, adShare] of [0.7, 0.3].entries()) {
          rows.push({
            adAccountId: adAccount.id,
            level: 'ad',
            objectId: `${adset}-a${adIndex + 1}`,
            objectName: `${campaign.name} · ${adIndex === 0 ? 'Image' : 'Carousel'} ${index + 1}`,
            date,
            ...figures(share * adShare),
          });
        }
      }

      account.spend += spend;
      account.clicks += clicks;
      account.impressions += impressions;
      account.reach += reach;
    }

    rows.push({
      adAccountId: adAccount.id,
      level: 'account',
      objectId: actId,
      objectName: adAccount.name,
      date,
      spend: Math.round(account.spend * 100) / 100,
      impressions: account.impressions,
      clicks: account.clicks,
      reach: Math.round(account.reach * 0.8),
      cpc: Math.round((account.spend / account.clicks) * 100) / 100,
      cpm: Math.round((account.spend / account.impressions) * 100000) / 100,
      ctr: Math.round((account.clicks / account.impressions) * 10000) / 100,
      actions: {
        actions: [
          { action_type: 'link_click', value: String(Math.round(account.clicks * 0.8)) },
          { action_type: 'post_engagement', value: String(Math.round(account.clicks * 2.4)) },
          { action_type: 'landing_page_view', value: String(Math.round(account.clicks * 0.55)) },
        ],
      },
    });
  }

  await prisma.adInsight.createMany({ data: rows });
  return { name: adAccount.name, days: 120 };
}

async function main(): Promise<void> {
  const requested = process.argv[2];

  const workspace = requested
    ? await prisma.workspace.findFirst({ where: { name: requested } })
    : ((await prisma.workspace.findFirst({ where: { name: 'Demo Workspace' } })) ??
      (await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } })));

  if (!workspace) {
    console.error(
      requested
        ? `No workspace is called "${requested}".`
        : 'There is no workspace yet. Register an account, or run `npm run db:seed`, first.',
    );
    process.exit(1);
  }

  const account = await prisma.socialAccount.upsert({
    where: {
      workspaceId_provider_providerUserId: {
        workspaceId: workspace.id,
        provider: 'facebook',
        providerUserId: 'demo-user',
      },
    },
    create: {
      workspaceId: workspace.id,
      providerUserId: 'demo-user',
      name: 'Demo connection',
      accessToken: encryptSecret('demo-user-token'),
      scopes: 'pages_show_list,pages_read_engagement,read_insights',
      tokenExpiresAt: new Date(Date.now() + 60 * DAY_MS),
    },
    update: {},
  });

  const now = new Date();
  for (const spec of PAGES) {
    const result = await seedPage(workspace.id, account.id, spec, now);
    console.log(`  ${result.name}: ${result.posts} posts over ${result.days} days`);
  }

  const ads = await seedAds(workspace.id, account.id, now);
  console.log(`  ${ads.name}: ${ads.days} days of ad delivery`);

  console.log(`Demo analytics added to "${workspace.name}". Open Analytics to see them.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
