import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { afterAuthPath, withInviteParam } from '../src/lib/invite-path';

/**
 * Accepting an invitation usually means signing in or registering first. The
 * token has to survive that detour, or the invitation is silently abandoned
 * halfway through the one flow it exists for.
 */
describe('afterAuthPath', () => {
  it('returns to the invitation when there is one', () => {
    expect(afterAuthPath('abc123')).toBe('/invite/abc123');
  });

  it('goes to the dashboard when there is not', () => {
    expect(afterAuthPath()).toBe('/dashboard');
    expect(afterAuthPath(null)).toBe('/dashboard');
    expect(afterAuthPath('')).toBe('/dashboard');
  });

  it('escapes a token rather than trusting it in a path', () => {
    expect(afterAuthPath('a/b?c')).toBe('/invite/a%2Fb%3Fc');
  });
});

describe('withInviteParam', () => {
  it('keeps the invitation across the sign-in and register links', () => {
    expect(withInviteParam('/login', 'abc123')).toBe('/login?invite=abc123');
  });

  it('leaves the path alone without one', () => {
    expect(withInviteParam('/login')).toBe('/login');
  });

  it('escapes the token', () => {
    expect(withInviteParam('/login', 'a&b=c')).toBe('/login?invite=a%26b%3Dc');
  });
});

describe('the pages that carry an invitation', () => {
  /**
   * The bug was not in a branch, it was in a parameter nobody read: the
   * invitation page linked to `/register?invite=…` and the register page's
   * signature had no search params at all. These check the wiring exists.
   */
  const files = {
    login: readFileSync('src/app/(auth)/login/page.tsx', 'utf8'),
    register: readFileSync('src/app/(auth)/register/page.tsx', 'utf8'),
    form: readFileSync('src/components/AuthForm.tsx', 'utf8'),
  };

  it('reads the invite parameter on both auth pages', () => {
    expect(files.login).toContain('searchParams');
    expect(files.login).toContain('inviteToken={invite}');
    expect(files.register).toContain('searchParams');
    expect(files.register).toContain('inviteToken={invite}');
  });

  it('sends the visitor onward with the shared helper', () => {
    expect(files.login).toContain('afterAuthPath(invite,');
    expect(files.register).toContain('afterAuthPath(invite)');
    expect(files.form).toContain('afterAuthPath(inviteToken)');
  });
});
