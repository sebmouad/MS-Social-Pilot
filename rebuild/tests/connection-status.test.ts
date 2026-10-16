import { describe, expect, it } from 'vitest';
import { connectionState } from '../src/lib/connection-status';

const now = new Date('2026-10-16T10:00:00Z');
describe('connection health', () => {
  it('requires reconnection at the exact expiry time', () => {
    expect(connectionState({ invalidatedAt: null, tokenExpiresAt: now }, now)).toBe('expired');
    expect(connectionState({ invalidatedAt: null, tokenExpiresAt: new Date(now.getTime() + 1) }, now)).toBe('connected');
  });
  it('marks revoked connections as needing reconnection even when their token has not expired', () => {
    expect(connectionState({ invalidatedAt: now, tokenExpiresAt: null }, now)).toBe('revoked');
  });
  it('accepts connections with no recorded expiration', () => {
    expect(connectionState({ invalidatedAt: null, tokenExpiresAt: null }, now)).toBe('connected');
  });
});
