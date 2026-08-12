import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import en from '../messages/en.json';
import fr from '../messages/fr.json';

/**
 * Every screen names itself in the browser tab.
 *
 * Twenty-five pages inherited one title from the root layout, so every tab
 * read "MS Social Pilot". That matters more here than on most products: this
 * one exists to run several clients at once and has a switcher for it, so an
 * agency keeps three windows open and, without this, cannot tell them apart.
 *
 * The check is that the key each page asks for actually resolves. A title of
 * "posts.title · Halloway Studio" is worse than the generic one it replaced.
 */

function pageFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return entry === 'page.tsx' ? [path] : [];
  });
}

const PAGES = pageFiles('src/app');

/** Pages with no title of their own, each for a reason. */
const INHERITS: Record<string, string> = {
  'src/app/page.tsx': 'Redirects before rendering; nobody sees a tab for it.',
  'src/app/data-deletion/page.tsx': 'A legal notice Meta links to, in English only.',
  'src/app/invite/[token]/page.tsx': 'Shown before the invitee belongs to any workspace.',
  'src/app/(app)/analytics/post/[postTargetId]/page.tsx':
    'Titled by the post it shows, which is not known until it is fetched.',
  'src/app/(app)/e2e-slow/page.tsx': 'Exists only for the browser walk.',
  'src/app/(app)/e2e-throw/page.tsx': 'Exists only for the browser walk.',
};

function resolve(catalogue: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    catalogue,
  );
}

describe('browser tab titles', () => {
  it('found the pages, so the rest of this is not vacuous', () => {
    expect(PAGES.length).toBeGreaterThan(20);
  });

  it('are set by every screen a person lands on', () => {
    // The call, not the identifier. Looking for the word anywhere passes on a
    // page that imports `screenMetadata` and never calls it, which is exactly
    // what deleting the block leaves behind.
    const silent = PAGES.filter(
      (path) => !/screenMetadata\('[^']+'\)/.test(readFileSync(path, 'utf8')) && !(path in INHERITS),
    );

    expect(silent, 'pages with no title of their own and no reason given').toEqual([]);
  });

  it('name a key that exists, in both languages', () => {
    const missing: string[] = [];

    for (const path of PAGES) {
      const source = readFileSync(path, 'utf8');
      const match = source.match(/screenMetadata\('([^']+)'\)/);
      if (!match) continue;

      const key = match[1]!;
      // A tab reading "posts.title · Halloway Studio" is worse than the
      // generic title it replaced.
      if (typeof resolve(en, key) !== 'string') missing.push(`en: ${key} (${path})`);
      if (typeof resolve(fr, key) !== 'string') missing.push(`fr: ${key} (${path})`);
    }

    expect(missing).toEqual([]);
  });

  it('has a stated reason for every page that stays generic', () => {
    const stale = Object.keys(INHERITS).filter((path) => !PAGES.includes(path));
    expect(stale, 'reasons given for pages that no longer exist').toEqual([]);

    for (const [path, reason] of Object.entries(INHERITS)) {
      expect(reason.length, `${path} has no real reason`).toBeGreaterThan(20);
    }
  });
});

/**
 * The phone tint. Next moved `themeColor` out of `metadata` and into
 * `viewport`; a metadata export still type-checks, but Next drops the value
 * and logs a warning, so the address bar keeps the browser's default grey.
 * Nothing in a screenshot test notices — the page looks the same, only the
 * chrome above it is wrong.
 */
describe('the theme colour', () => {
  const layout = readFileSync('src/app/layout.tsx', 'utf8');
  const manifest = readFileSync('src/app/manifest.ts', 'utf8');

  it('is declared where Next will actually read it', () => {
    expect(layout).toMatch(/export const viewport: Viewport = \{[^}]*themeColor:/);
    // And not in the export Next silently discards. Bounded to the body of
    // `generateMetadata` so the comment explaining all this doesn't count.
    const start = layout.indexOf('export async function generateMetadata');
    const body = layout.slice(start, layout.indexOf('\n}\n', start));
    expect(body).not.toContain('themeColor');
  });

  it('agrees with the colour a home-screen install gets', () => {
    const tint = layout.match(/themeColor: '(#[0-9a-f]{6})'/i)?.[1];
    const splash = manifest.match(/theme_color: '(#[0-9a-f]{6})'/i)?.[1];

    // Two tints for one app reads as a rendering bug to the person holding
    // the phone: the bar is one blue in the browser and another once pinned.
    expect(tint).toBeTruthy();
    expect(splash).toBe(tint);
  });
});
