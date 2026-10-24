import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), save: vi.fn(), dbActor: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.actor }));
vi.mock('../src/server/config/store', () => ({ readConfig: state.read }));
vi.mock('../src/server/data', () => {
  const tx = { user: { findUnique: state.dbActor }, appSetting: { upsert: state.save, deleteMany: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn() };
  return { prisma: { ...tx, $transaction: async (fn: (db: unknown) => unknown) => fn(tx) } };
});

import { GET, PUT } from '../src/app/api/root/config/route';

const policy = {
  presets: [{ id: '14d', days: 14, label: 'Last two weeks' }],
  defaultPreset: '14d', maxRangeDays: 14, maxFilterCharacters: 80,
};
const request = (body: unknown, origin = 'https://social.example.test') => new Request('https://social.example.test/api/root/config', {
  method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ ...(body as object), confirmation: `SET ROOT CONFIG ${(body as { key: string }).key}` }),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.actor.mockResolvedValue({ id: 'root-user', isInstanceOwner: true });
  state.dbActor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  state.read.mockResolvedValue([]);
  state.save.mockResolvedValue(undefined);
});

describe('Root config write validation', () => {
  it.each([[null, 401], [{ id: 'workspace-owner', isInstanceOwner: false }, 404], [{ id: 'root-user', isInstanceOwner: true }, 200]])('never caches private configuration reads: %j', async (actor, status) => {
    state.actor.mockResolvedValue(actor);
    const response = await GET(new Request('https://social.example.test/api/root/config'), undefined);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toContain('no-store');
    if (status !== 200) expect(state.read).not.toHaveBeenCalled();
  });
  it('masks configuration read failures and refuses caching the failure', async () => {
    state.read.mockRejectedValueOnce(new Error('DATABASE SECRET PAYLOAD'));
    const response = await GET(new Request('https://social.example.test/api/root/config'), undefined);
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(await response.json())).not.toContain('DATABASE SECRET PAYLOAD');
  });
  it.each([
    ['invalid default preset', { ...policy, defaultPreset: 'missing' }, /defaultPreset.*preset list/i],
    ['missing default preset', { presets: policy.presets, maxRangeDays: 14, maxFilterCharacters: 80 }, /defaultPreset/i],
    ['preset over range cap', { ...policy, maxRangeDays: 7 }, /maxRangeDays/i],
  ])('returns actionable 400 for %s using the registry schema', async (_label, value, message) => {
    const response = await PUT(request({ key: 'ads.reportingFilters', value }), undefined);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.error).toMatch(message);
    expect(state.save).not.toHaveBeenCalled();
  });

  it('saves a valid registry-checked Ads policy', async () => {
    const response = await PUT(request({ key: 'ads.reportingFilters', value: policy }), undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'ads.reportingFilters' }, create: expect.objectContaining({ value: policy, encrypted: false }) }));
  });

  it('preserves unknown-key rejection from the shared writer', async () => {
    const response = await PUT(request({ key: 'unknown.setting', value: true }), undefined);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Unknown configuration key.');
  });

  it('preserves the secret-only clear guard', async () => {
    const response = await PUT(request({ key: 'ads.reportingFilters', value: null, clear: true }), undefined);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Only secret values can be cleared.');
  });

  it('refuses cross-origin writes before authorization or persistence', async () => {
    const response = await PUT(request({ key: 'ads.reportingFilters', value: policy }, 'https://attacker.example.test'), undefined);
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.actor).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it.each([[null, 401], [{ id: 'workspace-owner', isInstanceOwner: false }, 404]])('refuses writes without installation-owner access: %j', async (actor, status) => {
    state.actor.mockResolvedValue(actor);
    const response = await PUT(request({ key: 'ads.reportingFilters', value: policy }), undefined);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.save).not.toHaveBeenCalled();
  });

  it('keeps persistence failures generic and does not expose their detail', async () => {
    state.save.mockRejectedValue(new Error('DATABASE SECRET PAYLOAD'));
    const response = await PUT(request({ key: 'ads.reportingFilters', value: policy }), undefined);
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.error).toBe('The change could not be confirmed. Check the current state before repeating it.');
    expect(JSON.stringify({ ...(body as object), confirmation: `SET ROOT CONFIG ${(body as { key: string }).key}` })).not.toContain('DATABASE SECRET PAYLOAD');
  });
});
