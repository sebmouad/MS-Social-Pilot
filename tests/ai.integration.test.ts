import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
