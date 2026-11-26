// Each Page's Facebook integrity status (2026-11-26): what counts as a change worth logging and alerting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageStatusChanges } from '@/modules/feeds/server/wordpress-page-status';
import { autopilotOf, AUTOPILOT_DEFAULTS, AUTOPILOT_LEARNED_KEYS } from '@/modules/feeds/wordpress/autopilot';

const pages = [{ id: 'a', name: 'Page A' }, { id: 'b', name: 'Page B' }, { id: 'c', name: 'Page C' }];
const now = new Date('2026-11-27T10:00:00Z');

test('page status: a first read reports only Pages that are not ok', () => {
  const { record, changes } = pageStatusChanges(undefined, pages, new Map([['a', { status: 'ok', violations: [] }], ['b', { status: 'warning', violations: [] }]]), now);
  assert.deepEqual(changes.map(c => [c.targetId, c.from, c.to]), [['b', null, 'warning']]);
  assert.deepEqual(record, { checkedAt: now.toISOString(), pages: { a: 'ok', b: 'warning' } });
});

test('page status: a move is reported both ways; a Page not read keeps its last status', () => {
  const previous = { checkedAt: '2026-11-26T10:00:00Z', pages: { a: 'ok' as const, b: 'warning' as const, c: 'ok' as const } };
  const { record, changes } = pageStatusChanges(previous, pages, new Map([['a', { status: 'restricted', violations: ['SPAM'] }], ['b', { status: 'ok', violations: [] }]]), now);
  assert.deepEqual(changes.map(c => [c.targetId, c.from, c.to, c.violations.join()]), [['a', 'ok', 'restricted', 'SPAM'], ['b', 'warning', 'ok', '']]);
  assert.equal(record.pages.c, 'ok', 'c was not read this time');
  assert.equal(pageStatusChanges(record, pages, new Map([['a', { status: 'restricted', violations: [] }]]), now).changes.length, 0, 'no change, no entry');
});

test('page status: stored with the autopilot, never overwritten by a settings form', () => {
  assert.ok((AUTOPILOT_LEARNED_KEYS as readonly string[]).includes('pageStatus'));
  const stored = { ...AUTOPILOT_DEFAULTS, pageStatus: { checkedAt: now.toISOString(), pages: { a: 'warning' } } };
  assert.equal(autopilotOf(stored).pageStatus?.pages.a, 'warning');
  assert.equal(autopilotOf({ ...AUTOPILOT_DEFAULTS, pageStatus: { checkedAt: 'x', pages: { a: 'banned' } } }).pageStatus, undefined, 'an unknown status is not kept');
});
