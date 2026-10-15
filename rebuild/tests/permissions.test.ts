import { describe, expect, it } from 'vitest';
import {
  authorizedFeatures,
  canAccessFeature,
  canAccessModule,
  canAccessPage,
  resolvePermissions,
  type PermissionSource,
} from '@/server/permissions';

const source = (overrides: Partial<PermissionSource> = {}): PermissionSource => ({
  role: 'editor',
  workspaceDisabledModules: [],
  memberDisabledModules: [],
  clientAccess: [],
  allPages: true,
  pageAccess: [],
  ...overrides,
});

describe('scoped permissions', () => {
  it('derives feature reads and writes from workspace role', () => {
    const editor = resolvePermissions(source({ role: 'editor' }));
    expect(canAccessFeature(editor, 'publishing/posts', 'read')).toBe(true);
    expect(canAccessFeature(editor, 'publishing/posts', 'write')).toBe(true);
    expect(canAccessFeature(editor, 'inbox/conversations', 'write')).toBe(true);
    expect(canAccessFeature(editor, 'ads/campaigns', 'write')).toBe(false);
    expect(canAccessFeature(editor, 'settings/team', 'read')).toBe(false);
    expect(canAccessFeature(editor, 'not-a-feature', 'read')).toBe(false);

    const viewer = resolvePermissions(source({ role: 'viewer' }));
    expect(canAccessModule(viewer, 'analytics', 'read')).toBe(true);
    expect(canAccessModule(viewer, 'analytics', 'write')).toBe(false);
    expect(canAccessFeature(viewer, 'settings/account', 'read')).toBe(true);
  });

  it('lets clients see only base features and explicitly granted client areas', () => {
    const client = resolvePermissions(source({ role: 'client', clientAccess: ['analytics'] }));
    expect(canAccessFeature(client, 'publishing/calendar', 'read')).toBe(true);
    expect(canAccessFeature(client, 'publishing/approvals', 'write')).toBe(true);
    expect(canAccessFeature(client, 'publishing/posts', 'write')).toBe(false);
    expect(canAccessFeature(client, 'analytics/overview', 'read')).toBe(true);
    expect(canAccessFeature(client, 'inbox/conversations', 'read')).toBe(false);
    expect(canAccessFeature(client, 'ads/overview', 'read')).toBe(false);
    expect(canAccessFeature(client, 'settings/account', 'write')).toBe(true);
    expect(client.visibleFeatures).toContain('analytics/overview');
    expect(client.visibleFeatures).not.toContain('inbox/conversations');
  });

  it('applies workspace and member disabled module and feature switches', () => {
    const permissions = resolvePermissions(source({
      workspaceDisabledModules: ['schedule'],
      memberDisabledModules: ['analytics/reports'],
    }));
    expect(canAccessModule(permissions, 'publishing', 'read')).toBe(false);
    expect(canAccessFeature(permissions, 'analytics/overview', 'read')).toBe(true);
    expect(canAccessFeature(permissions, 'analytics/reports', 'read')).toBe(false);
  });

  it('limits channel access to assigned targets and gives owners the full scope', () => {
    const limited = resolvePermissions(source({
      role: 'contributor',
      allPages: false,
      pageAccess: [{ targetId: 'page-a' }, { targetId: 'page-a' }, { targetId: '' }],
    }));
    expect(limited.pageScope).toEqual({ all: false, ids: ['page-a'] });
    expect(canAccessPage(limited, 'page-a')).toBe(true);
    expect(canAccessPage(limited, 'page-b')).toBe(false);
    expect(canAccessPage(limited, '')).toBe(false);

    const owner = resolvePermissions(source({ role: 'owner', allPages: false, pageAccess: [] }));
    expect(owner.pageScope).toEqual({ all: true });
    expect(canAccessPage(owner, 'page-b')).toBe(true);
  });

  it('filters a product catalog to features the member may read', () => {
    const permissions = resolvePermissions(source({ role: 'client', clientAccess: [] }));
    const features = authorizedFeatures(permissions, [
      { id: 'analytics/overview', label: 'Analytics' },
      { id: 'publishing/calendar', label: 'Calendar' },
      { id: 'ads/overview', label: 'Ads' },
    ]);
    expect(features.map(({ id }) => id)).toEqual(['publishing/calendar']);
  });
});
