import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRedirect } from '@/lib/route-redirects';

test('the bare /settings address opens Workspace; its sections are untouched', () => {
  assert.equal(resolveRedirect('/settings', ''), '/settings/workspace');
  assert.equal(resolveRedirect('/settings', 'channel=abc'), '/settings/workspace?channel=abc');
  assert.equal(resolveRedirect('/settings/workspace', ''), null);
  assert.equal(resolveRedirect('/settings/team', ''), null);
});
