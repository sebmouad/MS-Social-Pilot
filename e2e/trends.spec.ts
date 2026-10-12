import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { connectPretendPage, prisma } from './fixtures';

/** Trending topics (NEXT_PHASES H7): today's searches for the audience's country, kept to the team's subjects. */

let workspaceId = '';
let countries: string[] = [];
let targetId = '';
let pageCountries: string[] = [];

test.afterAll(async () => {
  await prisma.trendingTopic.deleteMany({ where: { title: { startsWith: 'e2e ' } } });
  if (targetId) await prisma.target.update({ where: { id: targetId }, data: { audienceCountries: pageCountries } });
  if (workspaceId) await prisma.workspace.update({ where: { id: workspaceId }, data: { audienceCountries: countries, trendKeywords: [] } });
});

test('lists today’s topics, filters them by subject and starts a post', async ({ page }) => {
  const failures = collectFailures(page);
  targetId = await connectPretendPage(OWNER.workspace);
  const target = await prisma.target.findUniqueOrThrow({ where: { id: targetId } });
  workspaceId = target.workspaceId;
  pageCountries = target.audienceCountries;
  countries = (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).audienceCountries;
  await prisma.target.update({ where: { id: targetId }, data: { audienceCountries: [] } });
  await prisma.workspace.update({ where: { id: workspaceId }, data: { audienceCountries: ['GB'], trendKeywords: [] } });
  await prisma.trendingTopic.createMany({
    data: [
      { country: 'GB', title: 'e2e product launch', traffic: '20,000+', newsTitle: 'A launch story', newsUrl: 'https://news.example/launch' },
      { country: 'GB', title: 'e2e weather', traffic: '500+' },
    ],
  });

  await open(page, `/calendar/trends?pages=${targetId}`);
  const country = page.getByRole('region', { name: 'United Kingdom' });
  await expect(country.getByText('e2e weather')).toBeVisible();
  await expect(country.getByText('20,000+ searches')).toBeVisible();

  const input = page.getByLabel(/words separated by commas/i);
  await expect(async () => {
    await input.fill('launch');
    await page.getByRole('button', { name: 'Save subjects' }).click();
    await expect(page.getByText('Subjects saved.')).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await expect(country.getByText('e2e weather')).toBeHidden();
  await expect(page.getByText('1 topic does not mention your subjects.')).toBeVisible();

  await country.getByRole('link', { name: 'Make a post about e2e product launch' }).click();
  await expect(page).toHaveURL(/\/compose\?/);
  await expect(page.getByLabel(/what do you want to say/i)).toHaveValue(/e2e product launch/);
  expect(failures).toEqual([]);
});
