import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Generic product: no owner-, country- or niche-specific
 * names in code or copy. Operator details come from root's configuration.
 * The time-zone list is the one place a city name belongs.
 */

const BLOCKED = ['morocc', 'maroc', 'casablanca', 'newsgeet', 'anasso', 'sebmouad', 'ikoula'];
const ALLOWED_FILES = ['src/lib/time.ts'];

describe('generic content', () => {
  it('names no owner, country or host in src/ or messages/', () => {
    let output = '';
    try {
      output = execFileSync('git', ['grep', '-niE', BLOCKED.join('|'), '--', 'src', 'messages'], { encoding: 'utf8' });
    } catch {
      output = ''; // git grep exits 1 when nothing matches
    }
    const hits = output
      .split('\n')
      .filter(Boolean)
      .filter((line) => !ALLOWED_FILES.some((file) => line.startsWith(`${file}:`)));
    expect(hits).toEqual([]);
  });
});
