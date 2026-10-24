import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Next's generated PageProps check rejects optional page props (`props?:` or `= {}`), which only `next build` reports. */
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : /\.tsx$/.test(name) ? [path] : []; });
const root = fileURLToPath(new URL('../src', import.meta.url));

describe('page component signatures', () => {
  it('never declares the page props parameter optional', () => {
    const offenders = [...walk(join(root, 'app')), ...walk(join(root, 'modules'))].filter(file => {
      const text = readFileSync(file, 'utf8');
      return /export default (async )?function \w+\([^)]*\}\s*=\s*\{\}\s*\)/.test(text) || /export default (async )?function \w+\(\s*\w+\?\s*:/.test(text);
    }).map(file => file.slice(root.length));
    expect(offenders).toEqual([]);
  });
});
