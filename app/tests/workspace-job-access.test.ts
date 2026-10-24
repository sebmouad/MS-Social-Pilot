import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  query: vi.fn(),
  runtimeConfig: vi.fn(),
  entitlements: vi.fn(),
  owners: [] as Array<{ userId: string }>,
  sources: new Map<string, unknown>(),
}));

vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: state.query } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));
vi.mock('../src/server/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/entitlements')>();
  return { ...actual, loadEntitlements: state.entitlements };
});

import { OperationError } from '../src/lib/operation-error';
import { resolveEntitlements, type EntitlementSource } from '../src/server/entitlements';
import { assertWorkspaceJobAccess } from '../src/server/jobs/access';

const request = { provider: 'facebook', anyFeatureOf: ['publishing/posts'] as const };
const workspaceId = 'workspace-current';

function ownerSource(options: {
  suspended?: boolean;
  provider?: boolean;
  feature?: boolean;
  instanceOwner?: boolean;
} = {}) {
  const { suspended = false, provider = true, feature = true, instanceOwner = false } = options;
  return {
    workspace: {
      id: workspaceId,
      disabledModules: feature ? [] : ['publishing/posts'],
      suspendedAt: suspended ? new Date('2026-01-01T00:00:00.000Z') : null,
    },
    membership: { userId: 'unused', disabledModules: [] },
    planFeatures: null,
    // Current owner job checks must never opt into Root's suspension inspection.
    isInstanceOwner: instanceOwner,
    platformSettings: provider ? [] : [{ key: 'platforms.facebook.enabled', value: false, encrypted: false }],
  } satisfies EntitlementSource;
}

function operation(error: unknown, code: string) {
  expect(error).toBeInstanceOf(OperationError);
  expect((error as OperationError).code).toBe(code);
}

function boundValues(call: unknown[]) {
  return call.slice(1);
}

beforeEach(() => {
  state.owners = [{ userId: 'owner-a' }];
  state.sources = new Map([['owner-a', ownerSource()]]);
  state.query.mockReset().mockImplementation(() => Promise.resolve(state.owners));
  state.runtimeConfig.mockReset().mockImplementation(async (key: string) => {
    if (key === 'jobs.workspaceOwnerPolicy') return 'any_active_owner';
    if (key === 'jobs.workspaceOwnerLimit') return 100;
    throw new Error(`unexpected config key: ${key}`);
  });
  state.entitlements.mockReset().mockImplementation(async (userId: string, requestedWorkspace: string, options: unknown) => {
    expect(requestedWorkspace).toBe(workspaceId);
    const source = state.sources.get(userId) as EntitlementSource | undefined;
    if (!source) return null;
    const allowInstallationInspection = (options as { allowInstallationInspection?: boolean } | undefined)?.allowInstallationInspection === true;
    return resolveEntitlements({
      ...source,
      membership: { ...source.membership, userId },
      isInstanceOwner: source.isInstanceOwner === true && allowInstallationInspection,
    });
  });
});

describe('workspace background-job access', () => {
  it('authorizes when one active workspace owner has both the provider and a requested feature', async () => {
    await expect(assertWorkspaceJobAccess(workspaceId, request)).resolves.toBeUndefined();
    expect(state.runtimeConfig).toHaveBeenCalledWith('jobs.workspaceOwnerPolicy');
    expect(state.runtimeConfig).toHaveBeenCalledWith('jobs.workspaceOwnerLimit');
    expect(state.entitlements).toHaveBeenCalledTimes(1);
    const values = boundValues(state.query.mock.calls[0] as unknown[]);
    expect(values).toContain(workspaceId);
    expect(values).toContain(101);
  });

  it('requires provider and one of the features on the same owner', async () => {
    state.owners = [{ userId: 'provider-only' }, { userId: 'feature-only' }];
    state.sources = new Map([
      ['provider-only', ownerSource({ provider: true, feature: false })],
      ['feature-only', ownerSource({ provider: false, feature: true })],
    ]);
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'forbidden');
      return true;
    });
    expect(state.entitlements).toHaveBeenCalledTimes(2);
  });

  it('accepts any requested feature when the same owner has the provider', async () => {
    state.sources.set('owner-a', ownerSource({ feature: false }));
    // This owner has Inbox but not Publishing. The provider and one requested
    // feature still belong to the same current entitlement result.
    await expect(assertWorkspaceJobAccess(workspaceId, {
      provider: 'facebook', anyFeatureOf: ['publishing/posts', 'inbox/conversations'],
    })).resolves.toBeUndefined();
  });

  it('evaluates current owner entitlements on every call so revocation takes effect', async () => {
    await expect(assertWorkspaceJobAccess(workspaceId, request)).resolves.toBeUndefined();
    state.sources.set('owner-a', ownerSource({ feature: false }));
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'forbidden');
      return true;
    });
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(state.entitlements).toHaveBeenCalledTimes(2);
  });

  it('does not let Root installation-owner status bypass a suspended workspace', async () => {
    state.sources.set('owner-a', ownerSource({ suspended: true, instanceOwner: true }));
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'forbidden');
      return true;
    });
    expect(state.entitlements).toHaveBeenCalledWith('owner-a', workspaceId, { allowInstallationInspection: false });
  });

  it('supports all-active-owners policy and refuses the workspace if any owner is ineligible', async () => {
    state.runtimeConfig.mockImplementation(async (key: string) => key === 'jobs.workspaceOwnerPolicy' ? 'all_active_owners' : 100);
    state.owners = [{ userId: 'owner-a' }, { userId: 'owner-b' }];
    state.sources.set('owner-b', ownerSource({ feature: false }));
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'forbidden');
      return true;
    });
    expect(state.entitlements).toHaveBeenCalledTimes(2);
  });

  it('uses the owner ceiling plus one and refuses an over-ceiling result without partial authorization', async () => {
    state.runtimeConfig.mockImplementation(async (key: string) => key === 'jobs.workspaceOwnerPolicy' ? 'any_active_owner' : 1);
    state.owners = [{ userId: 'owner-a' }, { userId: 'owner-b' }];
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'unavailable');
      return true;
    });
    expect(boundValues(state.query.mock.calls[0] as unknown[])).toContain(2);
    expect(state.entitlements).not.toHaveBeenCalled();
  });

  it('fails as unavailable when the configured owner ceiling is invalid', async () => {
    state.runtimeConfig.mockImplementation(async (key: string) => key === 'jobs.workspaceOwnerPolicy' ? 'any_active_owner' : 0);
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'unavailable');
      return true;
    });
    expect(state.query).not.toHaveBeenCalled();
  });

  it.each([
    ['missing active owners', []],
    ['no qualifying owner', [{ userId: 'owner-a' }]],
  ])('fails closed for %s', async (_label, owners) => {
    state.owners = owners;
    if (_label === 'no qualifying owner') state.sources.set('owner-a', ownerSource({ feature: false }));
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'forbidden');
      return true;
    });
  });

  it.each(['', 'other_policy', null])('fails closed on invalid policy value %s', async policy => {
    state.runtimeConfig.mockImplementation(async (key: string) => key === 'jobs.workspaceOwnerPolicy' ? policy : 100);
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'unavailable');
      return true;
    });
    expect(state.query).not.toHaveBeenCalled();
  });

  it.each([
    ['empty workspace', '', request],
    ['empty provider', workspaceId, { provider: '', anyFeatureOf: ['publishing/posts'] }],
    ['empty feature list', workspaceId, { provider: 'facebook', anyFeatureOf: [] }],
    ['unknown feature', workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/unknown'] }],
    ['unknown argument', workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'], allowSuspended: true }],
  ])('rejects %s as an invalid request', async (_label, workspace, input) => {
    await expect(assertWorkspaceJobAccess(workspace as string, input as typeof request)).rejects.toSatisfy(error => {
      operation(error, 'invalid_request');
      return true;
    });
    expect(state.query).not.toHaveBeenCalled();
  });

  it('propagates configuration, owner-query, and entitlement infrastructure errors unchanged', async () => {
    const configFailure = new Error('configuration storage unavailable');
    state.runtimeConfig.mockRejectedValueOnce(configFailure);
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toBe(configFailure);

    const queryFailure = new Error('database unavailable');
    state.query.mockRejectedValueOnce(queryFailure);
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toBe(queryFailure);

    const entitlementFailure = new Error('entitlement database unavailable');
    state.entitlements.mockRejectedValueOnce(entitlementFailure);
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toBe(entitlementFailure);
  });

  it('fails closed when an active owner has no current workspace entitlement membership', async () => {
    state.sources.clear();
    await expect(assertWorkspaceJobAccess(workspaceId, request)).rejects.toSatisfy(error => {
      operation(error, 'forbidden');
      return true;
    });
  });
});
