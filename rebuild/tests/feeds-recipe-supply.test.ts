import { describe, expect, it } from 'vitest';
import { ledgerView } from '../src/modules/feeds/server/wordpress-planner';
import { allocateRecipes } from '../src/modules/feeds/wordpress/recipe';
import type { LedgerRow } from '../src/modules/feeds/server/wordpress-store';

const now = new Date('2026-10-21T00:00:00Z');
const row = (wpPostId: string, days: number, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  id: wpPostId, sourceId: 's', targetId: 't', wpPostId, slotAt: new Date(now.getTime() - days * 86400000),
  state: 'planned', postId: `post-${wpPostId}`, title: '', permalink: null, reason: null, skipped: [], claimedAt: now,
  publishedAt: new Date(now.getTime() - days * 86400000), ...extra,
});
const policy = { enabled: true, cooldownDays: 30 };

describe('recipe reuse policy', () => {
  it('never reuses historical recipes while reuse is off', () => {
    const view = ledgerView([row('old', 500)], now, { ...policy, enabled: false });
    expect(view.blocked.get('t')?.has('old')).toBe(true);
  });
  it('allows only confirmed publications beyond the cooldown, including its exact boundary', () => {
    const view = ledgerView([row('old', 31), row('boundary', 30), row('recent', 29), row('unknown', 500, { publishedAt: null }), row('held', 500, { state: 'uncertain' })], now, policy);
    expect([...view.blocked.get('t')!].sort()).toEqual(['held', 'recent', 'unknown']);
  });
  it('keeps the latest use, future plans and failed recipes blocked regardless of older proof', () => {
    const view = ledgerView([row('repeat', 100), row('repeat', 2), row('future', 100), row('future', -1), row('failed', 100), row('x', 1, { state: 'failed', skipped: ['failed'] })], now, policy);
    expect([...view.blocked.get('t')!].sort()).toEqual(['failed', 'future', 'repeat']);
  });
  it('prefers fresh recipes, then the least recently published recipe rather than article order', () => {
    const view = ledgerView([row('newer', 40), row('older', 100), row('older', 50)], now, policy);
    const candidates = ['newer', 'older', 'fresh'].map(wpPostId => ({ wpPostId }));
    const { assignments } = allocateRecipes({ needs: [1, 2, 3].map(i => ({ targetId: 't', slotAt: new Date(now.getTime() + i * 3600000) })), candidates, ...view, distinct: true });
    expect(assignments.map(a => a.candidate.wpPostId)).toEqual(['fresh', 'older', 'newer']);
  });
});
