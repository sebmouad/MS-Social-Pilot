import { afterEach, describe, expect, it } from 'vitest';
import { formatWhen, formatWallTime, moveCandidates, rescheduleFailureMessage } from '@/lib/reschedule';

import { RESCHEDULE_POLICY, reschedulePolicySchema } from '@/lib/config/reschedule-policy';
import { applySynchronousPolicy, refreshSynchronousPolicy } from '@/server/synchronous-policy';
afterEach(() => applySynchronousPolicy('shared.reschedulePolicy', RESCHEDULE_POLICY));

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


describe('Root calendar helper policy', () => {
  it('applies runtime refresh to existing synchronous callers and serializable options', async () => {
    const policy = { ...RESCHEDULE_POLICY, locale: 'fr-FR' as const, hour12: false, moves: [{ id: 'two-days', unit: 'day' as const, amount: 2, label: { en: 'Two days later', fr: 'Deux jours plus tard' } }] };
    await refreshSynchronousPolicy(async key => { if (key === 'shared.reschedulePolicy') return policy; throw new Error('not part of this test'); });
    const options = moveCandidates('2026-10-20T13:00:00Z', 'UTC', now);
    expect(JSON.parse(JSON.stringify(options))).toEqual([{ id: 'two-days', label: 'Deux jours plus tard', date: '2026-10-22', time: '13:00' }]);
    expect(formatWhen('2026-10-20T13:00:00Z', 'UTC')).toContain('13:00');
    expect(formatWallTime('2026-10-20', '13:00', 'UTC')).toBe(formatWhen('2026-10-20T13:00:00Z', 'UTC'));
    expect(rescheduleFailureMessage(new Error('private database error'))).toBe(policy.failure.fr);
    // An explicit serialized policy also works in isolated browser helpers.
    applySynchronousPolicy('shared.reschedulePolicy', RESCHEDULE_POLICY);
    expect(moveCandidates('2026-10-20T13:00:00Z', 'UTC', now, policy)).toEqual(options);
  });
  it('validates moves and retains the last valid catalog on a bad refresh', async () => {
    expect(reschedulePolicySchema.safeParse({ ...RESCHEDULE_POLICY, moves: [RESCHEDULE_POLICY.moves[0], RESCHEDULE_POLICY.moves[0]] }).success).toBe(false);
    expect(reschedulePolicySchema.safeParse({ ...RESCHEDULE_POLICY, moves: [{ ...RESCHEDULE_POLICY.moves[0], amount: 0 }] }).success).toBe(false);
    await refreshSynchronousPolicy(async () => ({ locale: 'bad' }));
    expect(moveCandidates('2026-10-20T13:00:00Z', 'UTC', now)).toHaveLength(6);
    expect(() => applySynchronousPolicy('shared.reschedulePolicy', { locale: 'bad' })).toThrow();
  });
});
