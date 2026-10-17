import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.actor }));
vi.mock('../src/server/config/store', () => ({ readConfig: state.read, saveConfig: state.save }));

import { PUT } from '../src/app/api/root/config/route';

const policy = {
  presets: [{ id: '14d', days: 14, label: 'Last two weeks' }],
  defaultPreset: '14d', maxRangeDays: 14, maxFilterCharacters: 80,
};
const request = (body: unknown, origin = 'https://social.example.test') => new Request('https://social.example.test/api/root/config', {
  method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.actor.mockResolvedValue({ id: 'root-user', isInstanceOwner: true });
  state.read.mockResolvedValue([]);
  state.save.mockResolvedValue(undefined);
});

describe('Root config write validation', () => {
  it.each([
    ['invalid default preset', { ...policy, defaultPreset: 'missing' }, /defaultPreset.*preset list/i],
    ['missing default preset', { presets: policy.presets, maxRangeDays: 14, maxFilterCharacters: 80 }, /defaultPreset/i],
    ['preset over range cap', { ...policy, maxRangeDays: 7 }, /maxRangeDays/i],
  ])('returns actionable 400 for %s using the registry schema', async (_label, value, message) => {
    const response = await PUT(request({ key: 'ads.reportingFilters', value }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(message);
    expect(state.save).not.toHaveBeenCalled();
  });

  it('saves a valid registry-checked Ads policy', async () => {
    const response = await PUT(request({ key: 'ads.reportingFilters', value: policy }));
    expect(response.status).toBe(200);
    expect(state.save).toHaveBeenCalledWith({ key: 'ads.reportingFilters', value: policy }, 'root-user');
  });

  it('preserves unknown-key rejection from the shared writer', async () => {
    state.save.mockRejectedValue(new Error('Unknown configuration key.'));
    const response = await PUT(request({ key: 'unknown.setting', value: true }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Unknown configuration key.');
  });

  it('preserves the secret-only clear guard', async () => {
    state.save.mockRejectedValue(new Error('Only secret values can be cleared.'));
    const response = await PUT(request({ key: 'ads.reportingFilters', value: null, clear: true }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Only secret values can be cleared.');
  });

  it('refuses cross-origin writes before authorization or persistence', async () => {
    const response = await PUT(request({ key: 'ads.reportingFilters', value: policy }, 'https://attacker.example.test'));
    expect(response.status).toBe(403);
    expect(state.actor).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it.each([[null, 401], [{ id: 'workspace-owner', isInstanceOwner: false }, 404]])('refuses writes without installation-owner access: %j', async (actor, status) => {
    state.actor.mockResolvedValue(actor);
    const response = await PUT(request({ key: 'ads.reportingFilters', value: policy }));
    expect(response.status).toBe(status);
    expect(state.save).not.toHaveBeenCalled();
  });

  it('keeps persistence failures generic and does not expose their detail', async () => {
    state.save.mockRejectedValue(new Error('DATABASE SECRET PAYLOAD'));
    const response = await PUT(request({ key: 'ads.reportingFilters', value: policy }));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toBe('Configuration could not be saved.');
    expect(JSON.stringify(body)).not.toContain('DATABASE SECRET PAYLOAD');
  });
});
