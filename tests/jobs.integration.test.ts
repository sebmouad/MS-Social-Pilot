import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PostStatus, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The worker's background jobs.
 *
 * These are the ones nobody watches, so a regression here is invisible until a
 * customer notices: a token expiring with no warning, or an evergreen post
 * quietly repeating itself forever.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let jobs: typeof import('../src/lib/scheduler/jobs');
let evergreen: typeof import('../src/lib/evergreen');

const logger = () => undefined;

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('jobs');

  ({ prisma } = await import('../src/lib/prisma'));
  jobs = await import('../src/lib/scheduler/jobs');
  evergreen = await import('../src/lib/evergreen');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.notificationSetting.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seedWorkspace() {
  const { encryptSecret } = await import('../src/lib/crypto');

  const user = await prisma.user.create({
    data: { email: `owner-${randomBytes(3).toString('hex')}@example.com`, name: 'Owner', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Client',
      slug: `client-${randomBytes(3).toString('hex')}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role: WorkspaceRole.owner } },
    },
  });
  const account = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      providerUserId: randomBytes(4).toString('hex'),
      name: 'Sam Jones',
      accessToken: encryptSecret('user-token'),
    },
  });
  const target = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      type: 'page',
      providerId: '1000',
      name: 'Client Page',
      accessToken: encryptSecret('page-token'),
    },
  });

  return { user, workspace, account, target };
}

describe('token expiry warnings', () => {
  const now = new Date('2026-09-01T10:00:00Z');

  it('warns about a token expiring within a week', async () => {
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-05T10:00:00Z') },
    });

    const summary = await jobs.runTokenExpiryCheck({ now, logger });
    expect(summary).toMatch(/1 expiring token/);

    const after = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.expiryWarningSentAt).not.toBeNull();

    const email = await prisma.emailLog.findFirst({ where: { template: 'tokenExpiring' } });
    expect(email?.subject).toContain('Sam Jones');
  });

  it('warns only once per token', async () => {
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-05T10:00:00Z') },
    });

    await jobs.runTokenExpiryCheck({ now, logger });
    // A daily job must not email daily about the same token.
    const second = await jobs.runTokenExpiryCheck({ now, logger });

    expect(second).toBeNull();
    expect(await prisma.emailLog.count({ where: { template: 'tokenExpiring' } })).toBe(1);
  });

  it('ignores a token that is not near expiry', async () => {
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-11-01T10:00:00Z') },
    });

    expect(await jobs.runTokenExpiryCheck({ now, logger })).toBeNull();
  });

  it('ignores an already-expired token', async () => {
    // Nothing to warn about: it has already failed, and the failure path
    // handles telling people.
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-08-01T10:00:00Z') },
    });

    expect(await jobs.runTokenExpiryCheck({ now, logger })).toBeNull();
  });

  it('ignores a connection already flagged invalid', async () => {
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-05T10:00:00Z'), invalidatedAt: now },
    });

    expect(await jobs.runTokenExpiryCheck({ now, logger })).toBeNull();
  });

  it('respects an opt-out', async () => {
    const { account, user, workspace } = await seedWorkspace();
    await prisma.notificationSetting.create({
      data: { userId: user.id, workspaceId: workspace.id, onTokenExpiry: false },
    });
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-05T10:00:00Z') },
    });

    await jobs.runTokenExpiryCheck({ now, logger });
    expect(await prisma.emailLog.count({ where: { template: 'tokenExpiring' } })).toBe(0);
  });
});

describe('evergreen recycling', () => {
  const now = new Date('2026-09-01T10:00:00Z');

  async function seedEvergreen(overrides: { variants?: string[]; limit?: number | null } = {}) {
    const { user, workspace, target } = await seedWorkspace();
    const { toJson } = await import('../src/lib/json');

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'Original wording',
        status: PostStatus.published,
        publishedAt: new Date('2026-08-01T10:00:00Z'),
        scheduledAt: new Date('2026-08-01T10:00:00Z'),
        recycleEnabled: true,
        recycleEveryDays: 30,
        recycleLimit: overrides.limit === undefined ? 2 : overrides.limit,
        recycleNextAt: new Date('2026-08-31T10:00:00Z'),
        variants: toJson(overrides.variants ?? ['Second wording']),
        targets: { create: { targetId: target.id, status: 'published' } },
      },
    });

    return { post, workspace, target };
  }

  it('creates a copy rather than republishing the original row', async () => {
    const { post } = await seedEvergreen();

    const result = await evergreen.runEvergreenCycle({ now, logger });
    expect(result.created).toBe(1);

    const copy = await prisma.post.findFirstOrThrow({ where: { originPostId: post.id } });
    expect(copy.id).not.toBe(post.id);
    expect(copy.status).toBe(PostStatus.scheduled);

    // The original keeps its own published history intact.
    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.status).toBe(PostStatus.published);
    expect(original.recycleCount).toBe(1);
  });

  it('uses the next variant, so Facebook does not reject it as a duplicate', async () => {
    const { post } = await seedEvergreen();

    await evergreen.runEvergreenCycle({ now, logger });

    const copy = await prisma.post.findFirstOrThrow({ where: { originPostId: post.id } });
    expect(copy.message).toBe('Second wording');
  });

  it('copies the destinations', async () => {
    const { post, target } = await seedEvergreen();

    await evergreen.runEvergreenCycle({ now, logger });

    const copy = await prisma.post.findFirstOrThrow({
      where: { originPostId: post.id },
      include: { targets: true },
    });
    expect(copy.targets.map((entry) => entry.targetId)).toEqual([target.id]);
    expect(copy.targets[0]!.status).toBe('pending');
  });

  it('stops once the repeat limit is reached', async () => {
    const { post } = await seedEvergreen({ limit: 1 });

    await evergreen.runEvergreenCycle({ now, logger });

    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.recycleEnabled).toBe(false);
    expect(original.recycleNextAt).toBeNull();
  });

  it('schedules the following repeat when below the limit', async () => {
    const { post } = await seedEvergreen({ limit: 5 });

    await evergreen.runEvergreenCycle({ now, logger });

    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.recycleEnabled).toBe(true);
    expect(original.recycleNextAt?.toISOString()).toBe('2026-09-30T10:00:00.000Z');
  });

  it('leaves a post that is not due yet alone', async () => {
    const { post } = await seedEvergreen();
    await prisma.post.update({
      where: { id: post.id },
      data: { recycleNextAt: new Date('2026-12-01T10:00:00Z') },
    });

    expect((await evergreen.runEvergreenCycle({ now, logger })).created).toBe(0);
  });

  it('gives up on a post whose destinations have all gone', async () => {
    const { post } = await seedEvergreen();
    await prisma.postTarget.deleteMany({ where: { postId: post.id } });

    const result = await evergreen.runEvergreenCycle({ now, logger });
    expect(result.created).toBe(0);
    expect(result.finished).toBe(1);

    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.recycleEnabled).toBe(false);
  });

  it('stops recycling when every destination has been turned off', async () => {
    const { post, target } = await seedEvergreen();
    await prisma.target.update({ where: { id: target.id }, data: { enabled: false } });

    const result = await evergreen.runEvergreenCycle({ now, logger });
    // One dead copy would be a mistake; a new one every interval for ever is a
    // mess someone has to clean up by hand.
    expect(result.created).toBe(0);
    expect(result.finished).toBe(1);

    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.recycleEnabled).toBe(false);
    expect(original.recycleNextAt).toBeNull();
  });

  it('recycles into the destinations that are still on', async () => {
    const { post, workspace, target } = await seedEvergreen();
    const off = await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        type: 'page',
        providerId: '4000',
        name: 'Retired Page',
        enabled: false,
      },
    });
    await prisma.postTarget.create({ data: { postId: post.id, targetId: off.id, status: 'published' } });

    const result = await evergreen.runEvergreenCycle({ now, logger });
    expect(result.created).toBe(1);

    const copy = await prisma.post.findFirstOrThrow({
      where: { originPostId: post.id },
      include: { targets: true },
    });
    expect(copy.targets).toHaveLength(1);
    expect(copy.targets[0]!.targetId).toBe(target.id);
  });

  it('does not recycle a post that never published', async () => {
    const { post } = await seedEvergreen();
    await prisma.post.update({ where: { id: post.id }, data: { status: PostStatus.failed } });

    expect((await evergreen.runEvergreenCycle({ now, logger })).created).toBe(0);
  });
});

/**
 * The serverless trigger.
 *
 * Nothing authenticates ahead of this route — it is called by a cron service,
 * not a browser — so it is the one entry point with no session handler in front
 * of it to have loaded the settings snapshot. Getting that wrong is invisible:
 * the jobs still run, they just quietly ignore every value on the configuration
 * screen, starting with the secret that lets the caller in at all.
 */
/**
 * Alternate wordings are new text, published on a timer under the original
 * post's approval. Who may write them is therefore an approval question, not a
 * scheduling one.
 */
describe('setting recycling variants', () => {
  let authorId = '';

  async function seedPublished(requiresApproval: boolean) {
    const { user, workspace, target } = await seedWorkspace();
    authorId = user.id;
    await prisma.workspace.update({ where: { id: workspace.id }, data: { requiresApproval } });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'The approved wording',
        status: PostStatus.published,
        approvalStatus: 'approved',
        publishedAt: new Date('2026-08-01T10:00:00Z'),
        scheduledAt: new Date('2026-08-01T10:00:00Z'),
        targets: { create: { targetId: target.id, status: 'published' } },
      },
    });

    return { workspace, post };
  }

  function call(
    workspaceId: string,
    postId: string,
    role: WorkspaceRole,
    requiresApproval: boolean,
    variants?: string[],
    userId?: string,
  ) {
    return evergreen.setRecycling({
      workspaceId,
      postId,
      // Defaults to the post's author, so these cases exercise the variant rule
      // rather than the ownership one.
      userId: userId ?? authorId,
      role,
      requiresApproval,
      enabled: true,
      everyDays: 30,
      variants,
    });
  }

  it('refuses a contributor wording that nobody will review', async () => {
    const { workspace, post } = await seedPublished(true);

    await expect(
      call(workspace.id, post.id, WorkspaceRole.contributor, true, ['Anything I like']),
    ).rejects.toThrow(/only editors and above/i);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.recycleEnabled).toBe(false);
  });

  it('lets a contributor recycle the wording that was approved', async () => {
    const { workspace, post } = await seedPublished(true);

    await call(workspace.id, post.id, WorkspaceRole.contributor, true);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.recycleEnabled).toBe(true);
    expect(after.recycleNextAt).not.toBeNull();
  });

  it('ignores empty strings rather than treating them as new wording', async () => {
    const { workspace, post } = await seedPublished(true);

    await call(workspace.id, post.id, WorkspaceRole.contributor, true, ['', '   ']);

    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).recycleEnabled).toBe(true);
  });

  it('allows an editor, who could publish the same words directly', async () => {
    const { workspace, post } = await seedPublished(true);

    await call(workspace.id, post.id, WorkspaceRole.editor, true, ['A second wording']);

    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).recycleEnabled).toBe(true);
  });

  it('does not restrict a workspace that has no review step', async () => {
    const { workspace, post } = await seedPublished(false);

    await call(workspace.id, post.id, WorkspaceRole.contributor, false, ['A second wording']);

    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).recycleEnabled).toBe(true);
  });

  it('measures the first repeat from when the post will go out', async () => {
    const { user, workspace, target } = await seedWorkspace();
    authorId = user.id;
    const goesOutAt = new Date('2026-10-01T09:00:00Z');

    // Recycling is normally switched on while composing, long before there is
    // a publishedAt to measure from.
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'Scheduled for next month',
        status: PostStatus.scheduled,
        approvalStatus: 'not_required',
        scheduledAt: goesOutAt,
        targets: { create: { targetId: target.id } },
      },
    });

    await call(workspace.id, post.id, WorkspaceRole.owner, false);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    // A full interval after publication, not a full interval after the click —
    // which would have fallen due the moment the post went out.
    expect(after.recycleNextAt?.toISOString()).toBe('2026-10-31T09:00:00.000Z');
  });

  it('measures from publication once there is one', async () => {
    const { workspace, post } = await seedPublished(false);

    await call(workspace.id, post.id, WorkspaceRole.owner, false);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.recycleNextAt?.toISOString()).toBe('2026-08-31T10:00:00.000Z');
  });

  it('reports a post that is not there instead of claiming success', async () => {
    const { workspace } = await seedPublished(false);

    await expect(
      call(workspace.id, 'no-such-post', WorkspaceRole.owner, false),
    ).rejects.toThrow(/not found/i);
  });
});

/**
 * Meta's own callbacks.
 *
 * These are the only routes Facebook calls directly: no session, no wrapper,
 * nothing ahead of them to have loaded the settings snapshot — and the first
 * thing each needs is the app secret, which lives in the settings store.
 */
describe('Meta callbacks', () => {
  let settings: typeof import('../src/lib/settings');
  let deauthorize: typeof import('../src/app/api/facebook/deauthorize/route');
  let dataDeletion: typeof import('../src/app/api/facebook/data-deletion/route');

  /** The secret an operator typed on the configuration screen. */
  const configuredSecret = 'secret-set-on-the-config-screen';

  beforeAll(async () => {
    settings = await import('../src/lib/settings');
    deauthorize = await import('../src/app/api/facebook/deauthorize/route');
    dataDeletion = await import('../src/app/api/facebook/data-deletion/route');
  });

  async function signedRequest(secret: string, facebookUserId: string) {
    const { hmacHex } = await import('../src/lib/crypto');
    const payload = Buffer.from(
      JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: facebookUserId }),
    ).toString('base64url');
    const signature = Buffer.from(hmacHex(secret, payload), 'hex').toString('base64url');
    return `${signature}.${payload}`;
  }

  function post(body: string) {
    const form = new FormData();
    form.set('signed_request', body);
    return new Request('http://localhost/callback', { method: 'POST', body: form });
  }

  async function seedConnected() {
    const { workspace, account } = await seedWorkspace();
    return { workspace, account };
  }

  it('accepts a deauthorize callback signed with the configured secret', async () => {
    const { account } = await seedConnected();
    await settings.writeSetting('facebook.appSecret', configuredSecret, null);

    try {
      const response = await deauthorize.POST(
        post(await signedRequest(configuredSecret, account.providerUserId)),
      );
      expect(response.status).toBe(200);

      // The tokens are dead the moment the user removes the app, so the
      // connection has to be flagged now rather than at the next publish.
      const after = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(after.invalidatedAt).not.toBeNull();
    } finally {
      await settings.clearSetting('facebook.appSecret');
      await settings.ensureSettings();
    }
  });

  it('accepts a data deletion callback signed with the configured secret', async () => {
    const { account } = await seedConnected();
    await settings.writeSetting('facebook.appSecret', configuredSecret, null);

    try {
      const response = await dataDeletion.POST(
        post(await signedRequest(configuredSecret, account.providerUserId)),
      );
      expect(response.status).toBe(200);

      const body = (await response.json()) as { confirmation_code?: string };
      expect(body.confirmation_code).toBeTruthy();

      // Meta requires the deletion to have actually happened.
      expect(await prisma.socialAccount.findUnique({ where: { id: account.id } })).toBeNull();
    } finally {
      await settings.clearSetting('facebook.appSecret');
      await settings.ensureSettings();
    }
  });

  it('still rejects a request signed with the wrong secret', async () => {
    const { account } = await seedConnected();
    await settings.writeSetting('facebook.appSecret', configuredSecret, null);

    try {
      const response = await deauthorize.POST(
        post(await signedRequest('not-the-secret', account.providerUserId)),
      );
      expect(response.status).toBe(401);

      const after = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(after.invalidatedAt).toBeNull();
    } finally {
      await settings.clearSetting('facebook.appSecret');
      await settings.ensureSettings();
    }
  });
});

describe('POST /api/cron/tick', () => {
  let settings: typeof import('../src/lib/settings');
  let route: typeof import('../src/app/api/cron/tick/route');

  beforeAll(async () => {
    settings = await import('../src/lib/settings');
    route = await import('../src/app/api/cron/tick/route');
  });

  async function call(token: string, jobs: string) {
    return route.POST(
      new Request(`http://localhost/api/cron/tick?jobs=${jobs}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  }

  it('accepts a secret that only exists on the configuration screen', async () => {
    await settings.writeSetting('cron.secret', 'set-in-the-database', null);
    try {
      const response = await call('set-in-the-database', 'publish');
      expect(response.status).toBe(200);

      const body = (await response.json()) as { ran: string[] };
      expect(body.ran).toEqual(['publish']);
    } finally {
      await settings.clearSetting('cron.secret');
      await settings.ensureSettings();
    }
  });

  it('still rejects the wrong secret', async () => {
    await settings.writeSetting('cron.secret', 'set-in-the-database', null);
    try {
      expect((await call('guessed', 'publish')).status).toBe(401);
    } finally {
      await settings.clearSetting('cron.secret');
      await settings.ensureSettings();
    }
  });

  it('stays disabled when no secret is configured anywhere', async () => {
    await settings.ensureSettings();
    expect((await call('anything', 'publish')).status).toBe(404);
  });
});
