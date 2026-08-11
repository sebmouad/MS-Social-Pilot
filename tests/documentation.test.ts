import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The architecture notes explain decisions by naming the code that implements
 * them, which is what makes them worth reading and also what makes them rot.
 * A rename leaves prose pointing at a function nobody can find, and nothing
 * fails — the reader just loses confidence in the whole document.
 *
 * These checks are deliberately shallow. They do not ask whether the prose is
 * still true, only whether the things it points at still exist, which is the
 * part a machine can answer.
 */

const DOCS = ['docs/ARCHITECTURE.md', 'docs/DEPLOYMENT.md', 'docs/PROJECT_SCHEMA.md'];

/**
 * Names that are deliberately not in the source: things the documents discuss
 * as concepts rather than as code. Empty today, and kept as the place to say
 * so if that changes.
 */
const NOT_CODE = new Set<string>([]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const source = sourceFiles('src')
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

describe('the architecture notes', () => {
  it('name only symbols that exist', () => {
    const doc = readFileSync('docs/ARCHITECTURE.md', 'utf8');

    // Backticked identifiers that look like code rather than prose: camelCase
    // with at least one capital, which is how this codebase names things.
    const named = [
      ...new Set(
        [...doc.matchAll(/`([a-z][A-Za-z0-9_]*)`/g)]
          .map((match) => match[1]!)
          .filter((name) => /[A-Z]/.test(name) && !NOT_CODE.has(name)),
      ),
    ];

    expect(named.length).toBeGreaterThan(20);

    const missing = named.filter((name) => !new RegExp(`\\b${name}\\b`).test(source));
    expect(missing).toEqual([]);
  });
});

describe('every document', () => {
  it('points at files that are still there', () => {
    const missing: string[] = [];

    for (const doc of DOCS) {
      const text = readFileSync(doc, 'utf8');
      for (const match of text.matchAll(
        /`((?:src|tests|docs|prisma|scripts)\/[A-Za-z0-9_./[\]-]+)`/g,
      )) {
        const path = match[1]!;
        if (!existsSync(path)) missing.push(`${doc} → ${path}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
