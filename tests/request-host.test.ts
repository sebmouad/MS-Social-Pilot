import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nothing may build an address out of the request's own headers.
 *
 * Every absolute URL this app produces — OAuth redirects, short links, the
 * invitation link in an email to a colleague — comes from `APP_URL`. That is
 * what makes a forged `Host` header harmless, and it is a property that is
 * easy to lose: using the request's host looks like the helpful thing to do,
 * reads as "works on any domain", and turns an invitation mail into a link to
 * somebody else's server.
 *
 * A source check rather than a behavioural one, because the failure is the
 * *presence* of a pattern rather than a case that can be exercised.
 */

const FORBIDDEN = [
  /headers\(\)[\s\S]{0,80}\.get\(\s*['"`]host['"`]/i,
  /headers\.get\(\s*['"`]host['"`]/i,
  /headers\.get\(\s*['"`]x-forwarded-host['"`]/i,
  /headers\.get\(\s*['"`]x-forwarded-proto['"`]/i,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('absolute URLs', () => {
  it('are never built from the incoming request host', () => {
    const offenders = sourceFiles('src')
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return FORBIDDEN.some((pattern) => pattern.test(source));
      })
      .sort();

    expect(offenders).toEqual([]);
  });

  it('come from the configured app url', () => {
    // Not an exhaustive proof, just a floor: the email templates are where a
    // forged link would do the most damage, and they must go through env.
    const templates = readFileSync('src/lib/email/templates.ts', 'utf8');
    expect(templates).toContain('env.appUrl');
  });
});
