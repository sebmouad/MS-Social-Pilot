import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The app is sold as a generic service (CLAUDE.md rule 9): nothing in the
// shipped code or interface text may name the owner's own Pages, sites or
// country. Legal pages are the known exception until the operator details move
// to the root section — remove them from ALLOWED then.
const BLOCKED = [/newsgeet/i, /desomemes/i, /goltaf/i, /d[ée]lices rapides/i, /for lady/i, /\bmaroc\b/i, /morocc/i];
const ALLOWED = new Set(['src/app/privacy-policy/page.tsx', 'src/app/terms/page.tsx']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('generic product', () => {
  it('ships no owner-specific names in code or interface text', () => {
    const offenders = [...files('src'), ...files('messages')]
      .filter((path) => !ALLOWED.has(path))
      .flatMap((path) => {
        const text = readFileSync(path, 'utf8');
        return BLOCKED.filter((pattern) => pattern.test(text)).map((pattern) => `${path}: ${pattern}`);
      });
    expect(offenders).toEqual([]);
  });
});
