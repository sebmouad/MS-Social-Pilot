import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubReportEmailProvider } from './helpers/report-email';
import { AiGenerationKind, Locale } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Writing posts with Claude.
 *
 * Two things here cost real money and one of them is the only guard on it, so
 * the rate limit gets the most attention. The prompt matters for a different
 * reason: it is the difference between a draft somebody edits and one they
 * throw away, and the rules in it — no invented facts, no hashtags, no links —
 * are the ones that make the output usable in a client's feed.
 */

/** What the fake Anthropic client was asked to do. */
let sent: Array<{ model: string; system: string; prompt: string }> = [];
let reply = 'A cheerful post about the spring sale.';

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    // The provider's own model list, newest first: the app picks from it when
    // no model is configured (src/lib/ai-models.ts).
    models = {
      list: async function* () {
        yield { id: 'test-model-newest', display_name: 'Test newest', created_at: '2026-01-01T00:00:00Z' };
      },
    };
    messages = {
      create: async (request: {
        model: string;
        system: string;
        messages: Array<{ content: string }>;
      }) => {
        sent.push({
          model: request.model,
          system: request.system,
          prompt: request.messages[0]?.content ?? '',
        });
        return {
          content: [{ type: 'text', text: reply }],
          usage: { input_tokens: 120, output_tokens: 45 },
        };
      },
    };
  }
  return { default: Anthropic };
});

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let ai: typeof import('../src/lib/ai');
let settings: typeof import('../src/lib/settings');

beforeAll(async () => {
  setTestEnv({ ANTHROPIC_API_KEY: 'test-key' });
  database = setupTestDatabase('ai');

  ({ prisma } = await import('../src/lib/prisma'));
  ai = await import('../src/lib/ai');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  sent = [];
  reply = 'A cheerful post about the spring sale.';
  await prisma.aiGeneration.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
  await settings.clearSetting('ai.rateLimitPerHour');
  await settings.clearSetting('ai.monthlyBudgetUsd');
  await settings.clearSetting('ai.priceOverrides');
  await settings.ensureSettings();
});

async function seed() {
  const user = await prisma.user.create({
    data: { email: `sam-${randomBytes(3).toString('hex')}@example.com`, name: 'Sam', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Client', slug: `client-${randomBytes(3).toString('hex')}`, timezone: 'UTC' },
  });
  return { user, workspace };
}

function generate(workspaceId: string, userId: string, extra: Record<string, unknown> = {}) {
  return ai.generateCaption({
    workspaceId,
    userId,
    brief: 'Spring sale, 20% off everything, ends Sunday',
    locale: Locale.en,
    ...extra,
  });
}

describe('what the model is told', () => {
  it('asks for the post and nothing around it', async () => {
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id);

    const system = sent[0]?.system ?? '';
    expect(system).toMatch(/Return only the post text/i);
    expect(system).toMatch(/No preamble/i);
  });

  it('forbids the things that make a draft unusable', async () => {
    // Each of these is a rule somebody would otherwise have to catch by eye
    // before the post goes on a client's page.
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id);

    const system = sent[0]?.system ?? '';
    expect(system).toMatch(/Do not invent facts/i);
    expect(system).toMatch(/Do not add hashtags/i);
    expect(system).toMatch(/Do not include a link/i);
  });

  it('writes in the reader\'s language', async () => {
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id, { locale: Locale.fr });

    expect(sent[0]?.system).toMatch(/Write in French/);
  });

  it('writes for the Page\'s audience when it has one (H0)', async () => {
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id, { locale: Locale.en, audience: { languages: ['es-MX'], countries: ['MX', 'US'] } });

    expect(sent[0]?.system).toMatch(/Write in Mexican Spanish|Write in Spanish \(Mexico\)/);
    expect(sent[0]?.system).toMatch(/mainly in: Mexico, United States/);
  });

  it('translates for an audience and keeps links, hashtags and mentions (G11)', async () => {
    const { user, workspace } = await seed();
    reply = 'Nueva colección en la tienda #rebajas';
    const result = await ai.translateCaption({
      workspaceId: workspace.id,
      userId: user.id,
      text: 'New collection in store #sale @clienta https://example.com/new',
      language: 'es-MX',
      countries: ['MX'],
    });

    expect(sent[0]?.system).toMatch(/Translate into .*Spanish.*\(es-MX\)/);
    expect(sent[0]?.system).toMatch(/mainly in: Mexico/);
    expect(result.text).toBe('Nueva colección en la tienda #rebajas\n\n#sale @clienta https://example.com/new');
    expect(await prisma.aiGeneration.count({ where: { kind: AiGenerationKind.translate } })).toBe(1);
  });

  it('passes the tone and the brand voice through', async () => {
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id, {
      tone: 'playful',
      brandVoice: 'We are a family bakery. Warm, never corporate.',
    });

    expect(sent[0]?.system).toMatch(/Tone: playful/);
    expect(sent[0]?.system).toMatch(/family bakery/);
  });

  it('leaves out what was not given, rather than saying "none"', async () => {
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id);

    expect(sent[0]?.system).not.toMatch(/Tone:/);
    expect(sent[0]?.system).not.toMatch(/null/);
  });

  it('tells it to keep the facts when improving a draft', async () => {
    const { user, workspace } = await seed();
    await ai.improveCaption({
      workspaceId: workspace.id,
      userId: user.id,
      draft: 'we r open sunday 9-5 come by',
      locale: Locale.en,
    });

    expect(sent[0]?.prompt).toMatch(/Keep the same meaning/i);
    expect(sent[0]?.prompt).toMatch(/do not add or remove facts/i);
    expect(sent[0]?.prompt).toContain('we r open sunday 9-5 come by');
  });
});

describe('what it costs', () => {
  it('records every generation with its token counts', async () => {
    const { user, workspace } = await seed();
    const result = await generate(workspace.id, user.id);

    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(45);

    const row = await prisma.aiGeneration.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(row.kind).toBe(AiGenerationKind.generate);
    expect(row.inputTokens).toBe(120);
    expect(row.outputTokens).toBe(45);
  });

  it('adds up the last thirty days', async () => {
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id);
    await generate(workspace.id, user.id);

    const usage = await ai.usageSummary(workspace.id);
    expect(usage.generations).toBe(2);
    expect(usage.inputTokens).toBe(240);
    expect(usage.outputTokens).toBe(90);
  });

  it('keeps one workspace\'s spend out of another\'s', async () => {
    const mine = await seed();
    const theirs = await seed();
    await generate(theirs.workspace.id, theirs.user.id);

    expect((await ai.usageSummary(mine.workspace.id)).generations).toBe(0);
  });
});

describe('what it costs in dollars', () => {
  it('a model with no known price is recorded as unknown, not as free', async () => {
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id);

    const row = await prisma.aiGeneration.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(row.provider).toBe('anthropic');
    expect(row.costUsd).toBeNull();
  });

  it('prices each generation from the price root set', async () => {
    await settings.writeSetting('ai.priceOverrides', ['test-model-newest=3/15'], null);
    await settings.ensureSettings();
    const { user, workspace } = await seed();
    await generate(workspace.id, user.id);

    const row = await prisma.aiGeneration.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    // 120 input tokens at $3 and 45 output tokens at $15 per million.
    expect(row.costUsd).toBeCloseTo(0.001035, 9);
  });

  it('refuses a price written the wrong way', async () => {
    await expect(settings.writeSetting('ai.priceOverrides', ['test-model-newest=$3'], null)).rejects.toThrow(
      /model=input\/output/,
    );
  });

  it('adds spend up by model and workspace, keeping unpriced generations apart', async () => {
    const mine = await seed();
    const theirs = await seed();
    await generate(mine.workspace.id, mine.user.id);
    await settings.writeSetting('ai.priceOverrides', ['test-model-newest=3/15'], null);
    await settings.ensureSettings();
    await generate(mine.workspace.id, mine.user.id);
    await generate(theirs.workspace.id, theirs.user.id);

    const spend = await ai.aiSpend();
    expect(spend.last30Usd).toBeCloseTo(0.00207, 9);
    expect(spend.byModel).toEqual([
      expect.objectContaining({ provider: 'anthropic', model: 'test-model-newest', generations: 3, unpriced: 1 }),
    ]);
    const workspaces = Object.fromEntries(spend.byWorkspace.map((row) => [row.workspaceId, row]));
    expect(workspaces[mine.workspace.id]).toMatchObject({ generations: 2, unpriced: 1 });
    expect(workspaces[theirs.workspace.id]).toMatchObject({ generations: 1, unpriced: 0 });
  });
});

describe('the monthly budget', () => {
  it('stops every workspace once this month\'s spend reaches it', async () => {
    await settings.writeSetting('ai.priceOverrides', ['test-model-newest=3/15'], null);
    await settings.writeSetting('ai.monthlyBudgetUsd', 0.002, null);
    await settings.ensureSettings();
    const mine = await seed();
    const theirs = await seed();

    await generate(mine.workspace.id, mine.user.id);
    await generate(mine.workspace.id, mine.user.id);
    await expect(generate(theirs.workspace.id, theirs.user.id)).rejects.toMatchObject({
      key: 'errors.aiBudgetReached',
    });
    expect(sent).toHaveLength(2);
  });

  it('does not count last month', async () => {
    await settings.writeSetting('ai.monthlyBudgetUsd', 1, null);
    await settings.ensureSettings();
    const { user, workspace } = await seed();
    const now = new Date();
    await prisma.aiGeneration.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        kind: AiGenerationKind.generate,
        prompt: 'x',
        output: 'y',
        model: 'test-model-newest',
        costUsd: 50,
        createdAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1000),
      },
    });

    await expect(generate(workspace.id, user.id)).resolves.toBeTruthy();
  });

  it('0 means no budget', async () => {
    const { user, workspace } = await seed();
    await prisma.aiGeneration.create({
      data: { workspaceId: workspace.id, userId: user.id, kind: AiGenerationKind.generate, prompt: 'x', output: 'y', model: 'm', costUsd: 1e6 },
    });

    await expect(generate(workspace.id, user.id)).resolves.toBeTruthy();
  });
});

describe('the hourly limit', () => {
  it('stops at the configured number', async () => {
    await settings.writeSetting('ai.rateLimitPerHour', 2, null);
    await settings.ensureSettings();
    const { user, workspace } = await seed();

    await generate(workspace.id, user.id);
    await generate(workspace.id, user.id);

    await expect(generate(workspace.id, user.id)).rejects.toThrow(/usage limit/i);
    // And it stopped before spending anything, not after.
    expect(sent).toHaveLength(2);
  });

  it('counts only the last hour', async () => {
    await settings.writeSetting('ai.rateLimitPerHour', 1, null);
    await settings.ensureSettings();
    const { user, workspace } = await seed();

    await prisma.aiGeneration.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        kind: AiGenerationKind.generate,
        prompt: 'old',
        output: 'old',
        model: 'claude',
        inputTokens: 1,
        outputTokens: 1,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });

    await expect(generate(workspace.id, user.id)).resolves.toBeTruthy();
  });

  it('is per workspace, so one client cannot use up another\'s', async () => {
    await settings.writeSetting('ai.rateLimitPerHour', 1, null);
    await settings.ensureSettings();
    const mine = await seed();
    const theirs = await seed();

    await generate(mine.workspace.id, mine.user.id);

    await expect(generate(theirs.workspace.id, theirs.user.id)).resolves.toBeTruthy();
  });
});

describe('the recap on a scheduled report', () => {
  beforeEach(stubReportEmailProvider);
  afterEach(() => vi.restoreAllMocks());
  it('opens the email with a summary of the figures, billed to whoever set it up', async () => {
    const { user, workspace } = await seed();
    await prisma.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: 'owner' } });
    const target = await prisma.target.create({
      data: { workspaceId: workspace.id, type: 'page', providerId: `p-${randomBytes(3).toString('hex')}`, name: 'Client Page', accessToken: null },
    });
    const reports = await import('../src/lib/report-schedules');
    const schedule = await reports.createReportSchedule(
      workspace.id,
      { targetId: target.id, frequency: 'weekly', recipients: ['client@example.test'], aiRecap: true },
      user.id,
    );
    reply = 'Reach held steady with no posts this week.';

    expect(await reports.sendDueReports(schedule.nextRunAt)).toEqual({ sent: 1, failed: 0 });

    expect(sent[0]?.system).toMatch(/Never invent a cause/);
    expect(JSON.parse(sent[0]!.prompt)).toMatchObject({ page: 'Client Page', current: { posts: 0 }, previous: { posts: 0 } });
    const generation = await prisma.aiGeneration.findFirstOrThrow();
    expect(generation).toMatchObject({ kind: AiGenerationKind.recap, userId: user.id });
    const email = await prisma.emailLog.findFirstOrThrow({ where: { template: 'scheduledReport' } });
    expect(email.to).toBe('client@example.test');
    await prisma.emailLog.deleteMany();
    await prisma.reportSchedule.deleteMany();
    await prisma.target.deleteMany();
  });

  it('still sends the report when the workspace switched AI off', async () => {
    const { user, workspace } = await seed();
    await prisma.workspace.update({ where: { id: workspace.id }, data: { aiEnabled: false } });
    const target = await prisma.target.create({
      data: { workspaceId: workspace.id, type: 'page', providerId: `p-${randomBytes(3).toString('hex')}`, name: 'Client Page', accessToken: null },
    });
    const reports = await import('../src/lib/report-schedules');
    const schedule = await reports.createReportSchedule(
      workspace.id,
      { targetId: target.id, frequency: 'weekly', recipients: ['client@example.test'], aiRecap: true },
      user.id,
    );

    expect(await reports.sendDueReports(schedule.nextRunAt)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual([]);
    await prisma.emailLog.deleteMany();
    await prisma.reportSchedule.deleteMany();
    await prisma.target.deleteMany();
  });
});

describe('when things go wrong', () => {
  it('still returns the draft when the audit row cannot be written', async () => {
    // Losing the record of a generation must not lose somebody their draft.
    const { user, workspace } = await seed();
    const spy = vi
      .spyOn(prisma.aiGeneration, 'create')
      .mockRejectedValueOnce(new Error('database is having a moment'));

    const result = await generate(workspace.id, user.id);
    expect(result.text).toBe('A cheerful post about the spring sale.');

    spy.mockRestore();
  });

  it('trims what the model wraps around the text', async () => {
    reply = '\n\n  A cheerful post about the spring sale.  \n';
    const { user, workspace } = await seed();

    expect((await generate(workspace.id, user.id)).text).toBe(
      'A cheerful post about the spring sale.',
    );
  });
});
