import { describe, expect, it, vi } from 'vitest';
import { consumeRecoveryFragment } from '@/app/password-recovery/recovery-form';

describe('password recovery fragment handling', () => {
  it('reads a valid token from the fragment and removes it while preserving route state', () => {
    const replaceState = vi.fn();
    const token = Buffer.alloc(32, 4).toString('base64url');
    expect(consumeRecoveryFragment({ hash: `#token=${token}`, pathname: '/password-recovery', search: '?source=email' }, { replaceState })).toBe(token);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/password-recovery?source=email');
  });

  it('drops malformed tokens and always removes the fragment', () => {
    const replaceState = vi.fn();
    expect(consumeRecoveryFragment({ hash: '#token=not-a-token', pathname: '/password-recovery', search: '' }, { replaceState })).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/password-recovery');
  });
});
