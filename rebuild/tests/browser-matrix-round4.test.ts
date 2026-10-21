import { describe, expect, it } from 'vitest';
import { classifyBoundary, BOUNDARY_LOG_LEAK, BOUNDARY_ROUTES, LEAK_MARKER, type BoundaryObservation } from '../scripts/verify-browser-matrix';

const good: BoundaryObservation = {
  status: 200, theme: 'vivid', mode: 'light', wantTheme: 'vivid', wantMode: 'light', locale: 'en',
  text: 'We couldn’t load this page Your work is still here. Try loading the page again. Try again Back to home',
  retryButtons: 1, retryKeepsPage: true, backgroundLuminance: 0.95, homeLink: true,
  logs: ['An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.'], alerts: 1, boundaryShown: true,
};
const codes = (o: Partial<BoundaryObservation>) => classifyBoundary({ ...good, ...o }).map(f => f.code);

describe('page error boundary classification', () => {
  it('accepts a themed, translated boundary that logs nothing sensitive (a streamed 200 is legitimate)', () => expect(codes({})).toEqual([]));
  it('reports a page that did not throw instead of passing it', () => expect(codes({ boundaryShown: false, retryButtons: 0, alerts: 0 })).toEqual(['BOUNDARY_NOT_SIMULATED']));
  it('flags a digest, stack or driver detail on screen', () => {
    expect(codes({ text: `${good.text} Digest: 1526120244` })).toEqual(expect.arrayContaining(['SERVER_ERROR_LEAKS_DETAIL', 'BOUNDARY_DIGEST_ON_SCREEN']));
    expect(codes({ text: `${good.text} 1526120244` })).toContain('BOUNDARY_DIGEST_ON_SCREEN');
  });
  it('flags internals written to the browser console', () => {
    for (const line of ['Error: Invalid `prisma.label.findMany()` invocation', 'relation "labels" does not exist', '    at async r (.next/server/app/page.js:2:30957)', `body ${LEAK_MARKER}`, 'DATABASE_URL=postgresql://x']) {
      expect(codes({ logs: [line] })).toEqual(['BOUNDARY_LOGS_DETAIL']);
    }
  });
  it('requires the failure to be announced to assistive technology', () => expect(codes({ alerts: 0 })).toEqual(['BOUNDARY_NOT_ANNOUNCED']));
  it('inherits the theme, translation, retry and way-back rules', () => {
    expect(codes({ locale: 'fr' })).toContain('SERVER_ERROR_NOT_TRANSLATED');
    expect(codes({ backgroundLuminance: 0.05 })).toContain('SERVER_ERROR_NOT_THEMED');
    expect(codes({ retryButtons: 0, alerts: 1, boundaryShown: true })).toContain('SERVER_ERROR_NO_RETRY');
    expect(codes({ homeLink: false })).toContain('SERVER_ERROR_NO_WAY_BACK');
  });
  it('does not treat ordinary console text as a leak', () => {
    expect(BOUNDARY_LOG_LEAK.test('Download the font from the same origin')).toBe(false);
    expect(BOUNDARY_ROUTES.length).toBeGreaterThan(0);
  });
});
