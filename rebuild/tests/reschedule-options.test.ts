import { describe, expect, it } from 'vitest';
import { moveCandidates, rescheduleFailureMessage } from '@/lib/reschedule';

const now = Date.parse('2026-10-15T00:00:00Z');

describe('keyboard reschedule options', () => {
  it('offers hour, day and week moves in both directions in workspace time', () => {
    const options = moveCandidates('2026-10-20T13:00:00Z', 'America/New_York', now);
    expect(options.map(option => option.id)).toEqual(['hour-earlier', 'hour-later', 'day-earlier', 'day-later', 'week-earlier', 'week-later']);
    expect(options.find(option => option.id === 'hour-later')).toMatchObject({ date: '2026-10-20', time: '10:00' });
    expect(options.find(option => option.id === 'day-earlier')).toMatchObject({ date: '2026-10-19', time: '09:00' });
    expect(options.find(option => option.id === 'week-later')).toMatchObject({ date: '2026-10-27', time: '09:00' });
  });

  it('marks moves into the past as unavailable', () => {
    const options = moveCandidates('2026-10-15T00:30:00Z', 'UTC', now);
    expect(options.find(option => option.id === 'hour-earlier')?.unavailable).toBe('past');
    expect(options.find(option => option.id === 'day-earlier')?.unavailable).toBe('past');
    expect(options.find(option => option.id === 'day-later')?.unavailable).toBeUndefined();
  });

  it('keeps the local clock time across a daylight-saving change and flags skipped times', () => {
    const across = moveCandidates('2026-03-07T14:30:00Z', 'America/New_York', now);
    expect(across.find(option => option.id === 'day-later')).toMatchObject({ date: '2026-03-08', time: '09:30' });
    const skipped = moveCandidates('2026-03-07T07:30:00Z', 'America/New_York', now);
    expect(skipped.find(option => option.id === 'day-later')).toMatchObject({ date: '2026-03-08', time: '02:30', unavailable: 'skipped' });
  });

  it('shows known failures and hides unexpected ones', () => {
    expect(rescheduleFailureMessage(new Error('Choose a future publishing time.'))).toBe('Choose a future publishing time.');
    expect(rescheduleFailureMessage(new Error('connect ECONNREFUSED 10.0.0.1:5432'))).toMatch(/could not be moved/);
  });
});
