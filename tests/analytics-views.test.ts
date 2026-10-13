import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { ANALYTICS_VIEWS, PRIMARY_ANALYTICS_VIEWS, parseAnalyticsView } from '../src/lib/analytics-views';
import { canRefreshAnalytics, throttleAnalyticsRefresh } from '../src/lib/analytics';
import { AppError } from '../src/lib/errors';
import { reset } from '../src/lib/rate-limit';

describe('parseAnalyticsView', () => {
  it('keeps every known view, except those the Summary replaced', () => {
    for (const view of ANALYTICS_VIEWS) {
      expect(parseAnalyticsView(view)).toBe(view === 'analysis' || view === 'total' ? 'summary' : view);
    }
  });

  it('opens old analysis and total bookmarks on the Summary', () => {
    expect(parseAnalyticsView('analysis')).toBe('summary');
    expect(parseAnalyticsView('total')).toBe('summary');
  });

  it('lists exactly four views in the menu', () => {
    expect(PRIMARY_ANALYTICS_VIEWS).toEqual(['summary', 'posts', 'audience', 'compare']);
  });

  it('falls back to the summary for a missing or unknown view', () => {
    expect(parseAnalyticsView(undefined)).toBe('summary');
    expect(parseAnalyticsView('nonsense')).toBe('summary');
    // Inherited object keys are not views either.
    expect(parseAnalyticsView('constructor')).toBe('summary');
  });
});

describe('canRefreshAnalytics', () => {
  it('is for editors and above', () => {
    expect(canRefreshAnalytics(WorkspaceRole.contributor)).toBe(false);
    expect(canRefreshAnalytics(WorkspaceRole.editor)).toBe(true);
    expect(canRefreshAnalytics(WorkspaceRole.admin)).toBe(true);
    expect(canRefreshAnalytics(WorkspaceRole.owner)).toBe(true);
  });
});

describe('throttleAnalyticsRefresh', () => {
  beforeEach(() => reset());

  it('allows a handful per workspace, then refuses with a 429 and a wait', () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 6; attempt += 1) throttleAnalyticsRefresh('w1', now);

    let error: unknown;
    try {
      throttleAnalyticsRefresh('w1', now + 60_000);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(429);
    expect((error as AppError).params).toEqual({ minutes: 4 });

    // Another workspace has its own allowance.
    expect(() => throttleAnalyticsRefresh('w2', now)).not.toThrow();
    // And the window resets.
    expect(() => throttleAnalyticsRefresh('w1', now + 5 * 60_000)).not.toThrow();
  });
});
