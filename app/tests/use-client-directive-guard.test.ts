import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Next.js only honours 'use client' / 'use server' as the first statement; only `next build` reports a misplaced one. */
const root = fileURLToPath(new URL('../src', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : []; });

describe('module directives', () => {
  it("places 'use client' / 'use server' before every other statement", () => {
    const offenders = walk(root).filter(file => {
      const lines = readFileSync(file, 'utf8').split('\n');
      const directive = lines.findIndex(line => /^['"]use (client|server)['"];?\s*$/.test(line));
      if (directive < 0) return false;
      const first = lines.findIndex(line => line.trim() && !/^\s*(\/\/|\/\*|\*)/.test(line));
      return first !== directive;
    }).map(file => file.slice(root.length));
    expect(offenders).toEqual([]);
  });
});
