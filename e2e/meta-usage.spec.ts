import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** Meta API usage per Page (NEXT_PHASES H16): root sees the heaviest Pages and jobs of the last hour. */

test.afterAll(async () => {
  await prisma.graphUsage.deleteMany({ where: { key: 'worker' } });
});

test('root sees calls per Page and per job from the worker’s saved usage', async ({ page }) => {
  const failures = collectFailures(page);
  const targetId = await connectPretendPage(OWNER.workspace);
  const target = await prisma.target.findUniqueOrThrow({ where: { id: targetId } });
  const now = Date.now();
  const snapshot = {
    app: { percent: 12, throttledUntil: null, callsLastHour: 9, at: now },
    objects: [],
    calls: { objects: [{ id: target.providerId, calls: 7 }], jobs: [{ name: 'analytics', calls: 6 }, { name: '', calls: 3 }] },
  };
  await prisma.graphUsage.upsert({ where: { key: 'worker' }, create: { key: 'worker', snapshot }, update: { snapshot, savedAt: new Date() } });

  await open(page, '/root/worker');
  const pages = page.getByRole('table', { name: 'Heaviest Pages and accounts, last hour' });
  await expect(pages.getByRole('row', { name: new RegExp(target.name) })).toContainText('7');
  const jobs = page.getByRole('table', { name: 'Calls by job, last hour' });
  await expect(jobs.getByRole('row', { name: /Outside a job/ })).toContainText('3');
  await expect(jobs.getByRole('row')).toHaveCount(3);
  expect(failures).toEqual([]);
});
