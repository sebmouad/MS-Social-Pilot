import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MODULES, SHARED_LINKS, isDeveloperPath, isPageActive, isViewerRefused, mayUseDeveloperFeatures, moduleFor } from '../src/lib/modules';

/**
 * The app is three modules — Analytics, Ads, Schedule — and every screen
 * either belongs to one of them or is shared by all three.
 */

describe('the modules', () => {
  it('are exactly the three the app is for, in order', () => {
    expect(MODULES.map((module) => module.key)).toEqual(['analytics', 'ads', 'schedule']);
  });

  it('place each screen in the module it belongs to', () => {
    expect(moduleFor('/analytics')?.key).toBe('analytics');
    expect(moduleFor('/analytics/post/abc')?.key).toBe('analytics');
    expect(moduleFor('/reports')?.key).toBe('analytics');
    expect(moduleFor('/ads')?.key).toBe('ads');
    for (const path of ['/calendar', '/queue', '/posts', '/compose', '/approvals', '/feeds']) {
      expect(moduleFor(path)?.key, path).toBe('schedule');
    }
  });

  it('leave the shared screens outside every module', () => {
    for (const path of ['/dashboard', '/connections', '/accounts', '/settings', '/settings/team', '/setup']) {
      expect(moduleFor(path), path).toBeNull();
    }
  });

  it('do not mistake a prefix for a match', () => {
    // "/postscript" is not "/posts".
    expect(moduleFor('/postscript')).toBeNull();
    expect(isPageActive('/posts', { href: '/posts', label: 'posts', icon: 'posts' })).toBe(true);
    expect(isPageActive('/postscript', { href: '/posts', label: 'posts', icon: 'posts' })).toBe(false);
  });

  it('link only to screens that exist', () => {
    // Walk the app directory rather than trust the list: a module page whose
    // route was renamed would otherwise be a dead tab nobody notices.
    const routes = new Set<string>();
    const walk = (directory: string, prefix: string) => {
      for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);
        if (!statSync(full).isDirectory()) {
          if (entry === 'page.tsx') routes.add(prefix || '/');
          continue;
        }
        // Route groups like (app) add nothing to the path.
        walk(full, entry.startsWith('(') ? prefix : `${prefix}/${entry}`);
      }
    };
    walk('src/app', '');

    const links = [
      ...MODULES.flatMap((module) => [module.href, ...module.pages.map((page) => page.href)]),
      ...SHARED_LINKS.map((link) => link.href),
    ];
    for (const href of links) expect(routes.has(href), href).toBe(true);
  });
});

describe('root switching modules off', () => {
  it('leaves what neither the workspace nor the member has off', async () => {
    const { enabledModules } = await import('../src/lib/modules');
    expect(enabledModules([], [])).toEqual(['analytics', 'ads', 'schedule']);
    expect(enabledModules(['ads'], ['schedule'])).toEqual(['analytics']);
    expect(enabledModules(['unknown'])).toEqual(['analytics', 'ads', 'schedule']);
  });

  it('places API routes in their module, and leaves the shared ones out', async () => {
    const { moduleOfPath } = await import('../src/lib/modules');
    expect(moduleOfPath('/api/ads/accounts')).toBe('ads');
    expect(moduleOfPath('/api/posts/abc')).toBe('schedule');
    expect(moduleOfPath('/api/queue-slots')).toBe('schedule');
    expect(moduleOfPath('/api/reports')).toBe('analytics');
    expect(moduleOfPath('/api/settings/workspace')).toBeNull();
    expect(moduleOfPath('/calendar')).toBe('schedule');
    expect(moduleOfPath('/dashboard')).toBeNull();
  });
});

describe('developer features', () => {
  it('cover the API key and webhook screens and endpoints only', () => {
    for (const path of ['/settings/api', '/settings/webhooks', '/api/api-tokens', '/api/api-tokens/abc', '/api/webhooks/x', '/api/webhook-deliveries/y']) {
      expect(isDeveloperPath(path), path).toBe(true);
    }
    for (const path of ['/settings', '/settings/apis', '/api/v1/posts', '/settings/team']) expect(isDeveloperPath(path), path).toBe(false);
  });

  it('need root’s switch and the owner role', () => {
    expect(mayUseDeveloperFeatures({ role: 'owner', workspace: { developerFeatures: true } })).toBe(true);
    expect(mayUseDeveloperFeatures({ role: 'admin', workspace: { developerFeatures: true } })).toBe(false);
    expect(mayUseDeveloperFeatures({ role: 'owner', workspace: { developerFeatures: false } })).toBe(false);
  });
});

describe('the viewer role', () => {
  it('reads everything and writes only its own things', () => {
    expect(isViewerRefused('viewer', 'GET', '/api/posts')).toBe(false);
    expect(isViewerRefused('viewer', 'POST', '/api/posts')).toBe(true);
    expect(isViewerRefused('viewer', 'PATCH', '/api/inbox')).toBe(true);
    expect(isViewerRefused('viewer', 'DELETE', '/api/targets/abc')).toBe(true);
    expect(isViewerRefused('viewer', 'PATCH', '/api/account')).toBe(false);
    expect(isViewerRefused('viewer', 'POST', '/api/notifications/read')).toBe(false);
    expect(isViewerRefused('viewer', 'POST', '/api/accounts')).toBe(true);
  });

  it('leaves every other role alone', () => {
    for (const role of ['owner', 'admin', 'editor', 'contributor']) expect(isViewerRefused(role, 'POST', '/api/posts')).toBe(false);
  });
});
