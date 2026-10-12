import { describe, expect, it } from 'vitest';

import { homeFor, mayOpenScreen, mayWrite } from '../src/lib/role-access';

/** The viewer and the client (owner approved, 2026-10-12): the same rules in the sidebar and on the server. */
describe('the viewer role', () => {
  it('reads everything and writes only its own things', () => {
    expect(mayWrite('viewer', [], 'GET', '/api/posts')).toBe(true);
    expect(mayWrite('viewer', [], 'POST', '/api/posts')).toBe(false);
    expect(mayWrite('viewer', [], 'PATCH', '/api/inbox')).toBe(false);
    expect(mayWrite('viewer', [], 'DELETE', '/api/targets/abc')).toBe(false);
    expect(mayWrite('viewer', [], 'PATCH', '/api/account')).toBe(true);
    expect(mayWrite('viewer', [], 'POST', '/api/notifications/read')).toBe(true);
    expect(mayWrite('viewer', [], 'POST', '/api/accounts')).toBe(false);
    expect(mayWrite('viewer', [], 'POST', '/api/posts/abc/approve')).toBe(false);
  });

  it('does not see the screens that only change things', () => {
    expect(mayOpenScreen('viewer', [], '/dashboard')).toBe(true);
    expect(mayOpenScreen('viewer', [], '/analytics')).toBe(true);
    expect(mayOpenScreen('viewer', [], '/compose')).toBe(false);
    expect(mayOpenScreen('viewer', [], '/inbox')).toBe(true);
    expect(mayOpenScreen('viewer', [], '/inbox/rules')).toBe(false);
  });
});

describe('the client role', () => {
  it('opens the calendar, its posts and approvals, and its own settings', () => {
    for (const path of ['/calendar', '/posts', '/posts/abc', '/approvals', '/settings/account', '/settings/notifications']) {
      expect(mayOpenScreen('client', [], path)).toBe(true);
    }
    for (const path of ['/dashboard', '/calendar/trends', '/compose', '/settings', '/settings/team', '/connections', '/analytics', '/inbox', '/root']) {
      expect(mayOpenScreen('client', [], path)).toBe(false);
    }
  });

  it('opens more only where the workspace switched it on', () => {
    expect(mayOpenScreen('client', ['analytics'], '/analytics')).toBe(true);
    expect(mayOpenScreen('client', ['analytics'], '/reports/abc')).toBe(true);
    expect(mayOpenScreen('client', ['inbox'], '/inbox')).toBe(true);
    expect(mayOpenScreen('client', ['inbox'], '/inbox/rules')).toBe(false);
    expect(mayOpenScreen('client', ['library'], '/settings/media')).toBe(true);
    expect(mayOpenScreen('client', ['nonsense'], '/settings/team')).toBe(false);
  });

  it('approves and comments, and writes nothing else', () => {
    expect(mayWrite('client', [], 'POST', '/api/posts/abc/approve')).toBe(true);
    expect(mayWrite('client', [], 'POST', '/api/posts/abc/notes')).toBe(true);
    expect(mayWrite('client', [], 'PATCH', '/api/account')).toBe(true);
    expect(mayWrite('client', [], 'POST', '/api/posts')).toBe(false);
    expect(mayWrite('client', [], 'PATCH', '/api/posts/abc')).toBe(false);
    expect(mayWrite('client', [], 'PATCH', '/api/workspace')).toBe(false);
    expect(mayWrite('client', [], 'POST', '/api/media')).toBe(false);
    expect(mayWrite('client', ['library'], 'POST', '/api/media')).toBe(true);
    expect(mayWrite('client', ['inbox'], 'POST', '/api/inbox/abc/reply')).toBe(false);
  });

  it('lands on the calendar', () => {
    expect(homeFor('client')).toBe('/calendar');
    expect(homeFor('viewer')).toBe('/dashboard');
  });
});

describe('every other role', () => {
  it('is left to its own checks', () => {
    for (const role of ['owner', 'admin', 'editor', 'contributor']) {
      expect(mayWrite(role, [], 'POST', '/api/posts')).toBe(true);
      expect(mayOpenScreen(role, [], '/compose')).toBe(true);
    }
  });
});
