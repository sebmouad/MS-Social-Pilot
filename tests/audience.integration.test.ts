import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';
import { canonicalLanguage, effectiveAudience, EMPTY_AUDIENCE } from '../src/lib/audience';
import { workspaceSettingsSchema } from '../src/lib/validation';

/**
 * Target audience per Page: nothing assumed, the workspace's
 * defaults where a Page sets nothing, and suggestions from its own followers.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let suggestAudiences: typeof import('../src/lib/audience-data')['suggestAudiences'];

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('audience');
  ({ prisma } = await import('../src/lib/prisma'));
  ({ suggestAudiences } = await import('../src/lib/audience-data'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.pageInsight.deleteMany();
  await prisma.target.deleteMany();
  await prisma.workspace.deleteMany();
});

describe('audience helpers', () => {
  it('reads language tags in their canonical form, Facebook’s too', () => {
    expect(canonicalLanguage('fr_FR')).toBe('fr-FR');
    expect(canonicalLanguage(' EN-us ')).toBe('en-US');
    expect(canonicalLanguage('not a tag')).toBeNull();
    expect(canonicalLanguage('')).toBeNull();
  });

  it('follows the workspace for each part a Page leaves empty', () => {
    const workspace = { countries: ['CA'], languages: ['en-CA', 'fr-CA'], timezone: 'America/Toronto', calendars: ['international_days'] };
    expect(effectiveAudience({ ...EMPTY_AUDIENCE, countries: ['MX'] }, workspace, 'UTC')).toEqual({
      countries: ['MX'],
      languages: ['en-CA', 'fr-CA'],
      timezone: 'America/Toronto',
      calendars: ['international_days'],
    });
    expect(effectiveAudience(EMPTY_AUDIENCE, EMPTY_AUDIENCE, 'UTC').timezone).toBe('UTC');
  });

  it('accepts known countries, real language tags and listed calendars only', () => {
    expect(workspaceSettingsSchema.parse({ audienceLanguages: ['es_mx', 'es-MX'] }).audienceLanguages).toEqual(['es-MX']);
    expect(() => workspaceSettingsSchema.parse({ audienceCountries: ['XX'] })).toThrow();
    expect(() => workspaceSettingsSchema.parse({ audienceLanguages: ['not a tag'] })).toThrow();
    expect(() => workspaceSettingsSchema.parse({ audienceCalendars: ['made_up'] })).toThrow();
    expect(workspaceSettingsSchema.parse({ audienceTimezone: null }).audienceTimezone).toBeNull();
  });
});

describe('suggestAudiences', () => {
  it('suggests the top countries and languages from the newest follower breakdowns', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${Date.now()}` } });
    const page = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'page-1', name: 'Client A Page' } });
    const quiet = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'page-2', name: 'Client B Page' } });
    await prisma.pageInsight.createMany({
      data: [
        { targetId: page.id, metric: 'page_follows_country', period: 'lifetime', endTime: new Date('2026-10-01'), value: { US: 5 } },
        { targetId: page.id, metric: 'page_follows_country', period: 'lifetime', endTime: new Date('2026-10-10'), value: { MX: 50, US: 30, CA: 10, ES: 5 } },
        { targetId: page.id, metric: 'page_follows_locale', period: 'lifetime', endTime: new Date('2026-10-10'), value: { es_LA: 60, en_US: 30 } },
      ],
    });

    const suggestions = await suggestAudiences([page.id, quiet.id]);
    expect(suggestions[page.id]).toEqual({ countries: ['MX', 'US', 'CA'], languages: ['es-419', 'en-US'] });
    expect(suggestions[quiet.id]).toBeUndefined();
  });
});
