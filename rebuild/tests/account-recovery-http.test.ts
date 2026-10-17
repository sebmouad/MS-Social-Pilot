import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ request: vi.fn(), reset: vi.fn(), after: vi.fn(), addressHits: [] as string[] }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: (callback: () => void | Promise<void>) => state.after(callback) };
});
vi.mock('@/modules/settings/server/account-recovery', () => ({ requestPasswordRecovery: state.request, completePasswordRecovery: state.reset }));
vi.mock('@/server/rate-limit', () => ({ hit: (key: string) => { state.addressHits.push(key); return { allowed: true }; } }));
vi.mock('@/server/client-ip', () => ({ clientIp: () => null }));

import { POST as requestRoute } from '@/app/api/auth/recovery/request/route';
import { POST as resetRoute } from '@/app/api/auth/recovery/reset/route';

const origin = 'https://social.example';
function request(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks(); state.addressHits = [];
  state.request.mockResolvedValue({ requested: true }); state.reset.mockResolvedValue({ reset: true });
  state.after.mockImplementation((callback: () => void | Promise<void>) => { void callback(); });
});

describe('password recovery HTTP', () => {
  it('requires same origin and accepts only the email field', async () => {
    const crossOrigin = await requestRoute(request(`${origin}/api/auth/recovery/request`, { email: 'a@example.test' }, { origin: 'https://attacker.test' }));
    expect(crossOrigin.status).toBe(403);
    expect(state.after).not.toHaveBeenCalled();
    const extra = await requestRoute(request(`${origin}/api/auth/recovery/request`, { email: 'a@example.test', password: 'ignored' }));
    expect(extra.status).toBe(400);
    expect(state.after).not.toHaveBeenCalled();
  });

  it('returns one enumeration-safe no-store response and schedules delivery after response', async () => {
    state.request.mockRejectedValue(new Error('private mail failure'));
    const response = await requestRoute(request(`${origin}/api/auth/recovery/request`, { email: 'member@example.test' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requested: true, message: 'If an active account matches that address, a recovery link will be sent.' });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.after).toHaveBeenCalledOnce();
  });

  it('accepts the token only in the reset body, returns a receipt and never reflects it', async () => {
    const token = Buffer.alloc(32, 8).toString('base64url');
    const response = await resetRoute(request(`${origin}/api/auth/recovery/reset`, { token, password: 'a sufficiently long password' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reset: true });
    expect(state.reset).toHaveBeenCalledWith(token, 'a sufficiently long password');
    expect(await resetRoute(request(`${origin}/api/auth/recovery/reset`, { token, password: 'a sufficiently long password', userId: 'victim' })).then(r => r.status)).toBe(400);
  });
});
