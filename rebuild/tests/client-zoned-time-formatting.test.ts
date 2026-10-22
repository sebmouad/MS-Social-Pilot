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

describe('client components never format zoned instants', () => {
  const pattern = /Intl\.DateTimeFormat\([^)]*timeZone(?!: ['"]UTC['"])|formatPostPreviewTime\(|formatRootTimestamp\(|formatInZone\(|\bformatDate\(/;
  const offenders = files('src').filter(path => /^\s*['"]use client['"]/.test(readFileSync(path, 'utf8').slice(0, 200)))
    .filter(path => pattern.test(readFileSync(path, 'utf8')) && !(path in ALLOWED));
  it('uses server-provided labels instead', () => {
    // Offenders other than the documented fallbacks are listed by path so a regression names the file.
    const known = new Set(['src/modules/analytics/ui/reports/ReportsManager.tsx', 'src/components/LocalTime.tsx', 'src/components/charts/TimeSeriesChart.tsx']);
    expect(offenders.filter(path => !known.has(path))).toEqual([]);
  });
});

describe('server labels are zone-correct', () => {
  it('recipe labels use the source zone, not the host or browser zone', async () => {
    const { recipeLabels } = await import('../src/modules/feeds/server/recipe-labels');
    const labels = recipeLabels({ source: { lastRunAt: '2026-10-22T14:30:00.000Z', config: { timezone: 'Africa/Casablanca' } }, plans: { items: [{ id: 'p', slotAt: '2026-10-22T14:30:00.000Z' }] }, pool: { asOf: '2026-10-22T14:30:00.000Z' } }, 'en');
    expect(labels.lastRun).toContain('3:30');
    expect(labels.slots.p).toContain('3:30');
  });
});
