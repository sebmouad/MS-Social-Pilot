import { expect, it } from 'vitest';
import { composerCatalogDefaults, composerCatalogSchema, composerText, catalogGroup } from '@/modules/publishing/composer-catalog';
import { leadLabel } from '@/modules/publishing/ui/compose/remote-copy';

it('requires every English and French leaf and rejects unknown catalog keys', () => {
  const catalog = composerCatalogSchema.parse(JSON.parse(JSON.stringify(composerCatalogDefaults)));
  expect(catalog).toEqual(composerCatalogDefaults);
  expect(Object.values(catalog).every(value => value.en.length > 0 && value.fr.length > 0)).toBe(true);
  expect(composerCatalogSchema.safeParse({ ...catalog, screenTitle: { en: 'Title' } }).success).toBe(false);
  expect(composerCatalogSchema.safeParse({ ...catalog, unknown: { en: 'x', fr: 'x' } }).success).toBe(false);
});
it('applies Root templates to composer, queue, remote scheduling and version history', () => {
  const catalog = structuredClone(composerCatalogDefaults);
  catalog.composer_holdPlatform.fr = 'Programmé par {name}';
  catalog.queue_button.en = 'Use saved time';
  catalog.remote_hours.fr = '{n} heures adaptées';
  catalog.version_restore.en = 'Recover content';
  expect(composerText(catalog, 'fr').holdPlatform('Studio')).toBe('Programmé par Studio');
  expect(catalogGroup(catalog, 'queue', 'en').button).toBe('Use saved time');
  expect(leadLabel(7200, 'fr', catalog)).toBe('2 heures adaptées');
  expect(catalogGroup(catalog, 'version', 'en').restore).toBe('Recover content');
});
it('formats media support errors from the same edited Root catalog', async () => {
  const { publishingMediaIssue, publishingMediaFormatter } = await import('@/modules/publishing/media-support');
  const catalog = structuredClone(composerCatalogDefaults);
  catalog.media_unavailable.fr = 'Choisissez un autre canal pour ce média.';
  expect(publishingMediaIssue(undefined, [{ kind: 'image', url: 'https://images.example/a.jpg' }], null, publishingMediaFormatter(catalog, 'fr'))).toBe('Choisissez un autre canal pour ce média.');
  expect(publishingMediaIssue(undefined, [{ kind: 'image', url: 'https://images.example/a.jpg' }])).toBe(catalog.media_unavailable.en);
});
