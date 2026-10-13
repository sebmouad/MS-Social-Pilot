import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Engagement prediction, read from the posts the sync stored. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let outlook: typeof import('../src/lib/engagement-outlook');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('engagement_outlook');
  ({ prisma } = await import('../src/lib/prisma'));
  outlook = await import('../src/lib/engagement-outlook');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('engagement outlook', () => {
  it('compares a draft with the Page’s own posts found on Facebook', async () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a', timezone: 'UTC' } });
    const target = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: '1', name: 'Page A', accessToken: 'x' } });
    const insights = (reactions: number) => ({ impressions: null, reach: 1000, engagedUsers: null, reactions, comments: 0, shares: 0, clicks: 0 });
    await prisma.externalPost.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        targetId: target.id,
        remoteId: `p${index}`,
        createdTime: new Date(now.getTime() - (index + 1) * 86_400_000),
        message: 'A short note',
        statusType: index % 2 === 0 ? 'mobile_status_update' : 'added_photos',
        insights: insights(index % 2 === 0 ? 300 : 20),
      })),
    });

    const prediction = await outlook.engagementOutlook({
      targetId: target.id,
      timeZone: 'UTC',
      now,
      draft: { format: 'text', length: 20, hour: null, weekday: null },
    });
    expect(prediction.outlook).toBe('above');
    expect(prediction.basis).toBe(12);
    expect(prediction.reasons[0]).toMatchObject({ factor: 'format', value: 'text', posts: 6 });
  });
});
