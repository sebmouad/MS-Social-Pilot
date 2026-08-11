import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Runtime configuration.
 *
 * The property that matters is the precedence chain: database over environment
 * over default. Getting it wrong is quiet and expensive — a job interval that
 * silently ignores what the operator set on the screen looks exactly like a job
 * that is working.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let settings: typeof import('../src/lib/settings');
let envModule: typeof import('../src/lib/env');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('settings');

  ({ prisma } = await import('../src/lib/prisma'));
  settings = await import('../src/lib/settings');
  envModule = await import('../src/lib/env');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.appSetting.deleteMany();
  settings.invalidateSettings();
  await settings.ensureSettings();
});

afterEach(() => {
  delete process.env.SCHEDULER_POLL_SECONDS;
  delete process.env.FACEBOOK_ENABLE_ADS;
  delete process.env.AI_MODEL;
});

describe('precedence', () => {
  it('falls back to the registry default', async () => {
    expect(settings.setting('scheduler.pollSeconds')).toBe(30);
  });

  it('prefers the environment over the default', async () => {
    process.env.SCHEDULER_POLL_SECONDS = '45';
    expect(settings.setting('scheduler.pollSeconds')).toBe(45);
  });

  it('prefers the database over the environment', async () => {
    // The whole point of the config screen: what an operator sets there wins
    // over whatever is in the .env on the server.
    process.env.SCHEDULER_POLL_SECONDS = '45';
    await settings.writeSetting('scheduler.pollSeconds', 90, null);
    await settings.ensureSettings();

    expect(settings.setting('scheduler.pollSeconds')).toBe(90);
  });

  it('hands the setting back when the override is cleared', async () => {
    process.env.SCHEDULER_POLL_SECONDS = '45';
    await settings.writeSetting('scheduler.pollSeconds', 90, null);
    await settings.clearSetting('scheduler.pollSeconds');
    await settings.ensureSettings();

    expect(settings.setting('scheduler.pollSeconds')).toBe(45);
  });
});

describe('types', () => {
  it('returns numbers as numbers, whatever was stored', async () => {
    // "30" * 1000 is a bug that only shows up as wrong timing in production.
    await settings.writeSetting('scheduler.pollSeconds', '60', null);
    await settings.ensureSettings();

    expect(settings.setting('scheduler.pollSeconds')).toBe(60);
    expect(typeof settings.setting('scheduler.pollSeconds')).toBe('number');
  });

  it('reads a boolean from the environment’s several spellings', () => {
    for (const raw of ['true', '1', 'yes']) {
      process.env.FACEBOOK_ENABLE_ADS = raw;
      expect(settings.setting('features.ads'), raw).toBe(true);
    }
    process.env.FACEBOOK_ENABLE_ADS = 'no';
    expect(settings.setting('features.ads')).toBe(false);
  });

  it('splits a comma-separated list', async () => {
    await settings.writeSetting('facebook.scopes', 'pages_show_list, read_insights', null);
    await settings.ensureSettings();

    expect(settings.setting('facebook.scopes')).toEqual(['pages_show_list', 'read_insights']);
  });
});

describe('validation', () => {
  it('refuses a number outside its declared range', async () => {
    await expect(settings.writeSetting('scheduler.pollSeconds', 1, null)).rejects.toThrow(/at least/);
    await expect(settings.writeSetting('scheduler.concurrency', 999, null)).rejects.toThrow(/at most/);
  });

  it('refuses a value that is not a number at all', async () => {
    await expect(settings.writeSetting('scheduler.maxAttempts', 'often', null)).rejects.toThrow(
      /must be a number/,
    );
  });

  it('refuses an option outside the list', async () => {
    await expect(settings.writeSetting('ai.model', 'gpt-4', null)).rejects.toThrow(/one of/);
  });

  it('refuses a key that does not exist', async () => {
    await expect(settings.writeSetting('nope.nothing', 1, null)).rejects.toThrow(/Unknown setting/);
  });
});

describe('secrets', () => {
  it('stores a secret encrypted, not in plain text', async () => {
    await settings.writeSetting('ai.apiKey', 'sk-ant-secret-value', null);

    const row = await prisma.appSetting.findUniqueOrThrow({ where: { key: 'ai.apiKey' } });
    expect(row.encrypted).toBe(true);
    expect(JSON.stringify(row.value)).not.toContain('sk-ant-secret-value');

    await settings.ensureSettings();
    expect(settings.setting('ai.apiKey')).toBe('sk-ant-secret-value');
  });

  it('never reports a secret’s value to the screen', async () => {
    await settings.writeSetting('ai.apiKey', 'sk-ant-secret-value', null);

    const described = await settings.describeSettings();
    const entry = described.find((row) => row.key === 'ai.apiKey')!;

    expect(entry.hasValue).toBe(true);
    expect(entry.value).toBeUndefined();
    expect(JSON.stringify(described)).not.toContain('sk-ant-secret-value');
  });

  it('clears rather than storing an empty secret', async () => {
    await settings.writeSetting('ai.apiKey', 'sk-ant-secret-value', null);
    await settings.writeSetting('ai.apiKey', '', null);

    expect(await prisma.appSetting.count({ where: { key: 'ai.apiKey' } })).toBe(0);
  });
});

describe('describeSettings', () => {
  it('reports where each value came from', async () => {
    process.env.AI_MODEL = 'claude-opus-5';
    await settings.writeSetting('scheduler.pollSeconds', 90, null);

    const described = await settings.describeSettings();
    const byKey = new Map(described.map((row) => [row.key, row]));

    expect(byKey.get('scheduler.pollSeconds')!.source).toBe('database');
    expect(byKey.get('ai.model')!.source).toBe('environment');
    expect(byKey.get('scheduler.maxAttempts')!.source).toBe('default');
  });

  it('covers every registered setting', async () => {
    const described = await settings.describeSettings();
    expect(described).toHaveLength(settings.SETTING_DEFINITIONS.length);
  });
});

describe('env reads through the store', () => {
  it('sees a value set through the settings API', async () => {
    // env is what the rest of the app calls; if it did not follow the store,
    // the config screen would change a row and nothing else.
    await settings.writeSetting('scheduler.concurrency', 9, null);
    await settings.ensureSettings();

    expect(envModule.env.concurrency).toBe(9);
  });

  it('adds a feature’s scopes when the feature is switched on', async () => {
    await settings.writeSetting('features.ads', true, null);
    await settings.writeSetting('features.instagram', true, null);
    await settings.ensureSettings();

    expect(envModule.env.facebookScopes).toContain('ads_read');
    expect(envModule.env.facebookScopes).toContain('instagram_manage_insights');
  });

  it('leaves an unapproved feature’s scopes out entirely', async () => {
    // Requesting a permission the app is not approved for fails the whole
    // consent dialog, not just that permission.
    await settings.writeSetting('features.ads', false, null);
    await settings.ensureSettings();

    expect(envModule.env.facebookScopes).not.toContain('ads_read');
  });

  it('keeps the encryption key out of the store', () => {
    // It protects the store's own secrets; it cannot live inside it.
    expect(settings.SETTINGS_BY_KEY.has('ENCRYPTION_KEY')).toBe(false);
    expect(settings.SETTING_DEFINITIONS.some((row) => /encryptionKey|sessionSecret/i.test(row.key))).toBe(
      false,
    );
  });
});

describe('settings reach the worker', () => {
  it('schedules a job at the interval that was configured', async () => {
    // The whole chain, end to end: a number typed on the config screen has to
    // come back out as the interval the worker actually waits.
    const jobs = await import('../src/lib/scheduler/jobs');

    await settings.writeSetting('scheduler.pollSeconds', 120, null);
    await settings.ensureSettings();

    const publish = jobs.jobDefinitions().find((job) => job.name === 'publish')!;
    expect(publish.intervalMs).toBe(120_000);
  });

  it('does not schedule a job whose feature is switched off', async () => {
    // Running these unapproved spends the rate limit on a permission error
    // every pass, so they must not be in the table at all.
    const jobs = await import('../src/lib/scheduler/jobs');

    await settings.writeSetting('features.instagram', false, null);
    await settings.writeSetting('features.ads', false, null);
    await settings.ensureSettings();

    const names = jobs.jobDefinitions().map((job) => job.name);
    expect(names).not.toContain('instagram');
    expect(names).not.toContain('ads');
    // The always-on jobs are unaffected.
    expect(names).toContain('publish');
    expect(names).toContain('edges');
  });

  it('schedules it once the feature is switched on', async () => {
    const jobs = await import('../src/lib/scheduler/jobs');

    await settings.writeSetting('features.instagram', true, null);
    await settings.writeSetting('analytics.instagramSyncHours', 6, null);
    await settings.ensureSettings();

    const instagram = jobs.jobDefinitions().find((job) => job.name === 'instagram');
    expect(instagram?.intervalMs).toBe(6 * 60 * 60 * 1000);
  });
});

describe('the cache', () => {
  it('serves a change immediately in the process that made it', async () => {
    await settings.writeSetting('scheduler.maxAttempts', 9, null);
    // No ensureSettings: writing invalidates, and the next read reloads.
    await settings.ensureSettings();

    expect(settings.setting('scheduler.maxAttempts')).toBe(9);
  });

  it('picks up a change written directly to the table once invalidated', async () => {
    // Stands in for the other process: the worker writes nothing, it only
    // re-reads, and this is what it sees.
    await prisma.appSetting.create({ data: { key: 'scheduler.concurrency', value: 7 } });

    settings.invalidateSettings();
    await settings.ensureSettings();

    expect(settings.setting('scheduler.concurrency')).toBe(7);
  });

  it('ignores a stored row for a key the code no longer knows', async () => {
    // Rolling a deploy back must not lose the operator's other values, so an
    // unknown row is skipped rather than crashing the load.
    await prisma.appSetting.create({ data: { key: 'removed.setting', value: 'x' } });

    settings.invalidateSettings();
    await expect(settings.ensureSettings()).resolves.toBeUndefined();
    expect(settings.setting('scheduler.pollSeconds')).toBe(30);
  });
});

describe('registry hygiene', () => {
  it('has no duplicate keys', () => {
    const keys = settings.SETTING_DEFINITIONS.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every setting a label, a description and a group', () => {
    for (const definition of settings.SETTING_DEFINITIONS) {
      expect(definition.label.length, definition.key).toBeGreaterThan(2);
      expect(definition.description.length, definition.key).toBeGreaterThan(10);
      expect(settings.GROUP_ORDER, definition.key).toContain(definition.group);
    }
  });

  it('gives every number bounds, so a typo cannot set a one-second poll', () => {
    for (const definition of settings.SETTING_DEFINITIONS) {
      if (definition.type !== 'number') continue;
      expect(definition.min, definition.key).toBeDefined();
      expect(definition.max, definition.key).toBeDefined();
    }
  });

  it('gives every select its options', () => {
    for (const definition of settings.SETTING_DEFINITIONS) {
      if (definition.type !== 'select') continue;
      expect(definition.options?.length, definition.key).toBeGreaterThan(1);
    }
  });
});
