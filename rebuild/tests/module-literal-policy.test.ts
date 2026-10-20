import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ limit: 3, query: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: state.query, user: { findUnique: async () => ({ disabledAt: null }) }, membership: { findFirst: async () => ({ role: 'owner' }) } } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => state.limit }));
vi.mock('@/server/entitlements', () => ({ canUseFeature: () => true, loadEntitlements: async () => ({}) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: { all: true, ids: [] } }) }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: async () => undefined }));

import { qualifyingOwner } from '../src/modules/feeds/server/access';
import { MEDIA_CONFIG, MEDIA_DEFAULTS } from '../src/modules/media/config';
import { FEEDS_BOUNDS, FEEDS_CONFIG, FEEDS_DEFAULTS } from '../src/modules/feeds/config';
import { AI_BOUNDS, AI_CONFIG, AI_DEFAULTS } from '../src/modules/ai/config';
import { FEED_INPUT_SCHEMA, FEED_LIST_SCHEMA, feedInputSchema, feedListSchema, parseFeedDocument, wordpressApiUrl } from '../src/modules/feeds/feeds';
import { importSchema, libraryQuerySchema, safeAssetName } from '../src/modules/media/library';
import { summarizeSchema, aiRequestSchema, parseHashtags } from '../src/modules/ai/ai';
import { aiToolDefinitions } from '../src/modules/ai/mcp';

it('registers the module-owned operational defaults with validated overrides', () => {
  const setting = (entries: readonly { key: string; defaultValue: unknown; schema: { safeParse(value: unknown): { success: boolean } } }[], key: string) => entries.find(entry => entry.key === key)!;
  for (const [entries, key, value] of [
    [MEDIA_CONFIG, 'media.imageListLimit', MEDIA_DEFAULTS.imageListLimit],
    [MEDIA_CONFIG, 'media.holderExcerptCharacters', MEDIA_DEFAULTS.holderExcerptCharacters],
    [MEDIA_CONFIG, 'media.identifierMaxCharacters', MEDIA_DEFAULTS.identifierMaxCharacters],
    [MEDIA_CONFIG, 'media.pageNumberMax', MEDIA_DEFAULTS.pageNumberMax],
    [MEDIA_CONFIG, 'media.importUrlMaxCharacters', MEDIA_DEFAULTS.importUrlMaxCharacters],
    [MEDIA_CONFIG, 'media.assetNameMaxCharacters', MEDIA_DEFAULTS.assetNameMaxCharacters],
    [FEEDS_CONFIG, 'feeds.listScanMargin', FEEDS_DEFAULTS.listScanMargin],
    [FEEDS_CONFIG, 'feeds.qualifyingOwnerScanLimit', FEEDS_DEFAULTS.qualifyingOwnerScanLimit],
    [FEEDS_CONFIG, 'feeds.urlMaxCharacters', FEEDS_DEFAULTS.urlMaxCharacters],
    [FEEDS_CONFIG, 'feeds.identifierMaxCharacters', FEEDS_DEFAULTS.identifierMaxCharacters],
    [FEEDS_CONFIG, 'feeds.pageNumberMax', FEEDS_DEFAULTS.pageNumberMax],
    [FEEDS_CONFIG, 'feeds.hashtagsMaxCharacters', FEEDS_DEFAULTS.hashtagsMaxCharacters],
    [FEEDS_CONFIG, 'feeds.entryTitleMaxCharacters', FEEDS_DEFAULTS.entryTitleMaxCharacters],
    [FEEDS_CONFIG, 'feeds.entryGuidMaxCharacters', FEEDS_DEFAULTS.entryGuidMaxCharacters],
    [FEEDS_CONFIG, 'feeds.entryDescriptionMaxCharacters', FEEDS_DEFAULTS.entryDescriptionMaxCharacters],
    [FEEDS_CONFIG, 'feeds.wordpressPageSize', FEEDS_DEFAULTS.wordpressPageSize],
    [AI_CONFIG, 'ai.summaryMaxCharacters', AI_DEFAULTS.summaryMaxCharacters],
    [AI_CONFIG, 'ai.summarySubjectMaxCharacters', AI_DEFAULTS.summarySubjectMaxCharacters],
    [AI_CONFIG, 'ai.languageMaxCharacters', AI_DEFAULTS.languageMaxCharacters],
    [AI_CONFIG, 'ai.hashtagBodyMaxCharacters', AI_DEFAULTS.hashtagBodyMaxCharacters],
    [AI_CONFIG, 'ai.outputInputMultiplier', AI_DEFAULTS.outputInputMultiplier],
    [AI_CONFIG, 'ai.sentimentLookbackDays', AI_DEFAULTS.sentimentLookbackDays],
  ] as const) {
    const entry = setting(entries as never, key);
    expect(entry.defaultValue).toBe(value);
    expect(entry.schema.safeParse(value).success).toBe(true);
    expect(entry.schema.safeParse(-1).success).toBe(false);
  }
});

it('builds service schemas from configured validation ceilings', () => {
  const feedLimits = { maxName: 240, maxUrl: 4096, maxMessage: 20000, maxHashtags: 2000, maxTargets: 500, maxIdentifier: 128, maxSpread: 10080 };
  const feed = feedInputSchema(feedLimits).safeParse({ name: 'a'.repeat(241), url: `https://example.com/${'x'.repeat(2050)}`, hashtags: 'x'.repeat(1001), targetIds: ['a'.repeat(100)] });
  expect(feed.success).toBe(false); // The name exceeds its active setting.
  expect(feedInputSchema({ ...feedLimits, maxName: 300 }).safeParse({ name: 'a'.repeat(241), url: `https://example.com/${'x'.repeat(2050)}`, hashtags: 'x'.repeat(1001), targetIds: ['a'.repeat(100)] }).success).toBe(true);
  expect(feedListSchema(100001).safeParse({ page: 100001 }).success).toBe(true);
  expect(libraryQuerySchema(120, 1001).safeParse({ page: 1001 }).success).toBe(true);
  expect(importSchema(4096, 300).safeParse({ url: `https://example.com/${'x'.repeat(2050)}`, name: 'n'.repeat(200), confirmation: 'yes' }).success).toBe(true);
  expect(summarizeSchema(20000, 300).safeParse({ facts: 'metrics', subject: 's'.repeat(201) }).success).toBe(true);
});

it('keeps exported module schemas and parser defaults tied to their owning catalogs', () => {
  expect(FEED_INPUT_SCHEMA.safeParse({ name: 'n'.repeat(FEEDS_BOUNDS.nameMaxCharacters.max + 1), url: 'https://example.com' }).success).toBe(false);
  expect(FEED_LIST_SCHEMA.safeParse({ page: FEEDS_BOUNDS.pageNumberMax.max + 1 }).success).toBe(false);
  expect(wordpressApiUrl('https://example.com')).toContain(`per_page=${FEEDS_DEFAULTS.wordpressPageSize}`);
  const feed = parseFeedDocument(`<rss><item><title>${'t'.repeat(FEEDS_DEFAULTS.entryTitleMaxCharacters + 2)}</title><guid>${'g'.repeat(FEEDS_DEFAULTS.entryGuidMaxCharacters + 2)}</guid><description>${'d'.repeat(FEEDS_DEFAULTS.entryDescriptionMaxCharacters + 2)}</description></item></rss>`, 1)[0]!;
  expect(feed.title).toHaveLength(FEEDS_DEFAULTS.entryTitleMaxCharacters);
  expect(feed.guid).toHaveLength(FEEDS_DEFAULTS.entryGuidMaxCharacters);
  expect(feed.description).toHaveLength(FEEDS_DEFAULTS.entryDescriptionMaxCharacters);
  expect(safeAssetName('n'.repeat(MEDIA_DEFAULTS.assetNameMaxCharacters + 2), 'https://example.com/a', 'fallback')).toHaveLength(MEDIA_DEFAULTS.assetNameMaxCharacters);
});

it('accepts AI language and hashtag lengths from policy factories', () => {
  const request = { kind: 'translate', text: 'hello', language: 'L'.repeat(48) };
  expect(aiRequestSchema(20000, 32).safeParse(request).success).toBe(false);
  expect(aiRequestSchema(20000, 48).safeParse(request).success).toBe(true);
  expect(parseHashtags(`#${'a'.repeat(72)}`, 1, 80)).toEqual([`#${'a'.repeat(72)}`]);
  const languageMax = (aiToolDefinitions[1]!.inputSchema.properties as { language: { maxLength: number } }).language.maxLength;
  expect(languageMax).toBe(AI_BOUNDS.languageMaxCharacters.max);
});

it('applies the configured owner scan limit to the candidate query', async () => {
  state.query.mockResolvedValue([{ userId: 'owner-1' }]);
  await expect(qualifyingOwner('workspace-1')).resolves.toMatchObject({ actor: { userId: 'owner-1', workspaceId: 'workspace-1' } });
  expect(state.query.mock.calls[0]?.[2]).toBe(3);
});
