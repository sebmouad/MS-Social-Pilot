import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { customerCopy as agencyCopy } from '../src/modules/agency/ui/copy';
import { customerCopy as tasksCopy } from '../src/modules/tasks/ui/copy';
import { reportCopyDefaults } from '../src/modules/analytics/ui/reports/copy';

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
