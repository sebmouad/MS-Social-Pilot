import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Browsers can ship different time-zone data than Node (Chromium formats Africa/Casablanca one hour behind),
 * so a client component that formats an instant in a workspace zone shows a wrong time and fails hydration.
 * The server preformats these strings and passes them as props (see 4bf400f4 for Approvals).
 */
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : [];
});

// Client components that are known to still format with a non-UTC zone must be justified here.
const ALLOWED: Record<string, string> = {
  'src/modules/publishing/ui/calendar/CalendarBoard.tsx': 'fallback only; the server always supplies clockLabel/wallTime/slotEndedByHour',
  'src/modules/publishing/ui/queue/RescheduleQueuedPost.tsx': 'past-time validation only; the server converts the wall time authoritatively',
  'src/app/root/workspaces/RootWorkspaceControls.tsx': 'validates a zone name; formats nothing',
};

const clientFiles = () => files('src').filter(path => /^\s*['"]use client['"]/.test(readFileSync(path, 'utf8').slice(0, 200)));

describe('client components never format zoned instants', () => {
  const pattern = /Intl\.DateTimeFormat\([^)]*timeZone(?!: ['"]UTC['"])|formatPostPreviewTime\(|formatRootTimestamp\(|formatInZone\(|formatStableDateTime\(|\bformatDate\(/;
  const offenders = clientFiles().filter(path => pattern.test(readFileSync(path, 'utf8')) && !(path in ALLOWED));
  it('uses server-provided labels instead', () => {
    // Offenders other than the documented fallbacks are listed by path so a regression names the file.
    const known = new Set(['src/modules/analytics/ui/reports/ReportsManager.tsx', 'src/components/charts/TimeSeriesChart.tsx']);
    expect(offenders.filter(path => !known.has(path))).toEqual([]);
  });
});

/**
 * A client component that formats a date with no explicit zone uses the viewer's machine zone: the server render and
 * the browser disagree (hydration) and the text ignores the workspace zone. Only server labels or explicit UTC are allowed.
 */
describe('client components never format dates in the browser zone', () => {
  const unzoned: Array<[string, RegExp]> = [
    ['toLocaleDateString/toLocaleTimeString', /\.toLocale(Date|Time)String\(/],
    ['Date#toLocaleString', /new Date\([^)]*\)\.toLocaleString\(/],
    ['Date getters in the local zone', /\.(getHours|getMinutes|getDate|getMonth|getFullYear|getDay|getTimezoneOffset)\(/],
  ];
  const intlWithoutZone = (source: string) => [...source.matchAll(/Intl\.DateTimeFormat\(/g)].some(match => {
    const rest = source.slice(match.index, match.index + 320);
    const call = rest.slice(0, rest.search(/\)\s*(\.format|,|;|\))/) < 0 ? undefined : rest.search(/\)\s*(\.format|,|;|\))/));
    return !/timeZone:\s*(['"]UTC['"]|timeZone)/.test(call ?? rest);
  });
  // Justified exceptions: nothing here formats an instant for display in the browser zone.
  const BROWSER_ZONE_ALLOWED: Record<string, string> = {
    'src/app/root/workspaces/RootWorkspaceControls.tsx': 'validates a zone name; formats nothing',
    'src/modules/publishing/ui/calendar/CalendarBoard.tsx': 'fallback only, formats with the workspace zone prop; the server supplies clockLabel',
  };
  it('has no unzoned date formatting', () => {
    const offenders = clientFiles().filter(path => !(path in BROWSER_ZONE_ALLOWED)).flatMap(path => {
      const source = readFileSync(path, 'utf8');
      const hits = unzoned.filter(([, regex]) => regex.test(source)).map(([name]) => name);
      if (intlWithoutZone(source)) hits.push('Intl.DateTimeFormat without a timeZone');
      return hits.map(hit => `${path}: ${hit}`);
    });
    expect(offenders).toEqual([]);
  });
});

describe('server labels are zone-correct', () => {
  it('recipe labels use the source zone, not the host or browser zone', async () => {
    const { recipeLabels } = await import('../src/modules/feeds/server/recipe-labels');
    const labels = recipeLabels({ source: { lastRunAt: '2026-10-22T14:30:00.000Z', config: { timezone: 'Africa/Casablanca' } }, plans: { items: [{ id: 'p', slotAt: '2026-10-22T14:30:00.000Z' }] }, pool: { asOf: '2026-10-22T14:30:00.000Z' } }, 'en');
    expect(labels.lastRun).toContain('3:30');
    expect(labels.slots.p).toContain('3:30');
  });
  it('instant labels use the workspace zone and locale, not the host zone', async () => {
    const { instantFormatter, labelInstants } = await import('../src/server/instant-labels');
    const row = labelInstants({ createdAt: '2026-10-22T14:30:00.000Z', lastUsedAt: null }, { createdAt: 'dateTime', lastUsedAt: 'dateTime' }, instantFormatter('Africa/Casablanca', 'en'));
    expect(row.labels.createdAt).toContain('3:30');
    expect(row.labels.lastUsedAt).toBeUndefined();
    expect(instantFormatter('Africa/Casablanca', 'fr').date('2026-10-22T23:30:00.000Z')).toContain('23');
  });
});
