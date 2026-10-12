import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Plan limits count across a subscriber's workspaces; root and no plan are unlimited. */
let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let plans: typeof import('../src/lib/plans');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('plans');
  ({ prisma } = await import('../src/lib/prisma'));
  plans = await import('../src/lib/plans');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('plan limits', () => {
  it('starts sign-ups on the default plan', async () => {
    await prisma.plan.create({ data: { id: 'plan_free', key: 'free', name: 'Free', channels: 3, members: 1, workspaces: 1, isDefault: true } });
    expect(await plans.defaultPlanId()).toBe('plan_free');
  });

  it('refuses a channel past the plan, until root gives extra ones', async () => {
    const user = await prisma.user.create({ data: { email: 'sub@example.com', name: 'Sub', passwordHash: 'x', planId: 'plan_free' } });
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a', memberships: { create: { userId: user.id, role: WorkspaceRole.owner } } } });
    for (const id of ['1', '2', '3']) await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: id, name: `Page ${id}` } });

    await expect(plans.assertRoom(workspace.id, 'channels')).rejects.toMatchObject({ key: 'errors.planLimit_channels', status: 402 });
    await prisma.user.update({ where: { id: user.id }, data: { extraChannels: 1 } });
    await expect(plans.assertRoom(workspace.id, 'channels')).resolves.toBeUndefined();

    await expect(plans.assertWorkspaceRoom(user.id)).rejects.toMatchObject({ key: 'errors.planLimit_workspaces' });
    await prisma.user.update({ where: { id: user.id }, data: { planId: null } });
    await expect(plans.assertWorkspaceRoom(user.id)).resolves.toBeUndefined();
  });

  it('counts posts and AI credits per month, and gates plan features', async () => {
    await prisma.plan.create({ data: { id: 'plan_tiny', key: 'tiny', name: 'Tiny', postsPerMonth: 1, aiCredits: 1, features: ['api'] } });
    const user = await prisma.user.create({ data: { email: 'tiny@example.com', name: 'Tiny', passwordHash: 'x', planId: 'plan_tiny' } });
    const workspace = await prisma.workspace.create({ data: { name: 'Client B', slug: 'client-b', memberships: { create: { userId: user.id, role: WorkspaceRole.owner } } } });

    await expect(plans.assertMonthlyRoom(workspace.id, 'postsPerMonth')).resolves.toBeUndefined();
    await prisma.post.create({ data: { workspaceId: workspace.id, authorId: user.id, message: 'Product launch' } });
    await expect(plans.assertMonthlyRoom(workspace.id, 'postsPerMonth')).rejects.toMatchObject({ key: 'errors.planLimit_postsPerMonth', status: 402 });
    // Last month's posts do not count.
    await expect(plans.assertMonthlyRoom(workspace.id, 'postsPerMonth', new Date(Date.now() + 40 * 86_400_000))).resolves.toBeUndefined();

    await prisma.aiGeneration.create({ data: { workspaceId: workspace.id, userId: user.id, kind: 'generate', prompt: 'p', output: 'o', model: 'm' } });
    await expect(plans.assertMonthlyRoom(workspace.id, 'aiCredits')).rejects.toMatchObject({ key: 'errors.planLimit_aiCredits' });

    await expect(plans.assertFeature(workspace.id, 'api')).resolves.toBeUndefined();
    await expect(plans.assertFeature(workspace.id, 'clients')).rejects.toMatchObject({ key: 'errors.planFeature_clients', status: 402 });
  });
});
