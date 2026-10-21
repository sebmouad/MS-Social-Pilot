import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { customerCopy as agencyCopy } from '../src/modules/agency/ui/copy';
import { customerCopy as tasksCopy } from '../src/modules/tasks/ui/copy';
import { reportCopyDefaults } from '../src/modules/analytics/ui/reports/copy';
import { ownerCopy, ownerCopySchema, ownerText, resolveOwnerCopy } from '../src/modules/sharing/ui/owner-copy';
import { publicCopy, publicCopyDefaults, publicCopySchema } from '../src/modules/sharing/ui/copy';
import { mediaCopy } from '../src/modules/media/copy';
import { feedsCopy } from '../src/modules/feeds/copy';
import { recipeCopy } from '../src/modules/feeds/copy-recipes';
import { MEDIA_CONFIG } from '../src/modules/media/config';
import { FEEDS_CONFIG } from '../src/modules/feeds/config';
import { SHARING_CONFIG } from '../src/modules/sharing/config';

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

/** Literal first arguments of the module's `t("...")` helper; a key missing from its catalog silently stays English. */
function literalKeys(dir: string, files: RegExp): string[] {
  const keys = new Set<string>();
  for (const file of walk(dir).filter(path => files.test(path))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*(["'])((?:(?!\1)[^\\\n]|\\.)+)\1/g)) keys.add(match[2]!.replace(/\\n/g, '\n').replace(/\\(["'])/g, '$1'));
  }
  return [...keys].sort();
}

describe('customer copy catalogs cover every literal used by their screens', () => {
  it.each([
    ['agency', 'src/modules/agency/ui', /\.tsx$/, agencyCopy],
    ['tasks', 'src/modules/tasks/ui', /\.tsx$/, tasksCopy],
    ['analytics reports', 'src/modules/analytics/ui/reports', /\.tsx$/, reportCopyDefaults],
  ] as const)('%s', (_name, dir, files, catalog) => {
    const entries = catalog as Record<string, { en: string; fr: string }>;
    expect(literalKeys(dir, files).filter(key => !entries[key])).toEqual([]);
    for (const [key, value] of Object.entries(entries)) {
      expect(value.en.trim(), key).not.toBe('');
      expect(value.fr.trim(), key).not.toBe('');
    }
  });
});

const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();

describe('sharing screens read their text from Root-editable catalogs', () => {
  it('every phrase used by the owner screens has English and French text with the same placeholders', () => {
    expect(literalKeys('src/modules/sharing/ui', /\.tsx$/).filter(key => !(key in ownerCopy))).toEqual([]);
    for (const [key, value] of Object.entries(ownerCopy)) {
      expect(value.en.trim(), key).not.toBe('');
      expect(value.fr.trim(), key).not.toBe('');
      expect(placeholders(value.fr), key).toEqual(placeholders(value.en));
    }
  });

  it('keeps the shipped defaults valid for Root and resolves one language at a time', () => {
    expect(ownerCopySchema.safeParse(ownerCopy).success).toBe(true);
    expect(publicCopySchema.safeParse(publicCopyDefaults).success).toBe(true);
    const fr = ownerText(resolveOwnerCopy('fr'));
    expect(fr('Select all')).toBe('Tout sélectionner');
    expect(fr('{0} of {1} selected', 2, 5)).toBe('2 sur 5 sélectionné(s)');
    expect(ownerText(resolveOwnerCopy('en'))('Unlisted phrase {0}', 1)).toBe('Unlisted phrase 1');
  });

  it('serves an edited visitor catalog and rejects one with a missing line', () => {
    const edited = structuredClone(publicCopyDefaults);
    edited.fr.share.truncated = 'Seules {0} publications.';
    expect(publicCopy('fr', edited).share.truncated(3)).toBe('Seules 3 publications.');
    expect(publicCopy('en').share.moreFiles(1)).toBe('1 more uploaded file attached (no preview)');
    const broken = structuredClone(publicCopyDefaults) as { en: { rateLimited?: string } };
    delete broken.en.rateLimited;
    expect(publicCopySchema.safeParse(broken).success).toBe(false);
  });

  it('declares the catalogs as active Root settings', () => {
    const keys = new Map([...MEDIA_CONFIG, ...FEEDS_CONFIG, ...SHARING_CONFIG].map(item => [item.key, item]));
    for (const key of ['media.copy', 'feeds.copy', 'feeds.recipeCopy', 'sharing.ownerCopy', 'sharing.publicCopy']) {
      expect(keys.get(key)?.consumption, key).toBe('active');
      expect(keys.get(key)!.schema.safeParse(keys.get(key)!.defaultValue).success, key).toBe(true);
    }
  });
});

describe('media and feeds keyed catalogs cover every key their screens use', () => {
  it.each([
    ['media', 'src/modules/media/ui', mediaCopy],
    ['feeds', 'src/modules/feeds/ui/FeedManager.tsx', feedsCopy],
    ['feeds screen', 'src/modules/feeds/ui/FeedsScreen.tsx', feedsCopy],
    ['recipes', 'src/modules/feeds/ui/RecipeSource.tsx', recipeCopy],
  ] as const)('%s', (_name, path, catalog) => {
    const files = statSync(path).isDirectory() ? walk(path).filter(file => /\.tsx$/.test(file)) : [path];
    const keys = new Set<string>();
    for (const file of files) for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'(\w+)'/g)) keys.add(match[1]!);
    expect([...keys].filter(key => !(key in catalog.en) || !(key in catalog.fr))).toEqual([]);
    expect(Object.keys(catalog.fr).sort()).toEqual(Object.keys(catalog.en).sort());
  });
});
