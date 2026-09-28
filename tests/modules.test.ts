import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MODULES, SHARED_LINKS, isPageActive, moduleFor } from '../src/lib/modules';

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
    for (const path of ['/calendar', '/posts', '/compose', '/approvals', '/feeds']) {
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
