import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { areaPages } from '../src/lib/product';
import { PAGES } from '../src/lib/product';
import { resolveRedirect } from '../src/lib/route-redirects';
import { SECTION_TABS } from '../src/modules/settings/ui/section-tabs';
import { sectionsCopy, sectionsCopySchema } from '../src/modules/settings/ui/sections-copy';

const all = PAGES.filter(page => page.area === 'settings').map(page => page.id);

describe('Settings design v2 (B6)', () => {
  it('lists seven sections plus History in the in-content list, in the specified order', () => {
    const ids = areaPages('settings', all).map(page => page.id);
    expect(ids).toEqual(['settings/workspace', 'settings/connections', 'settings/team', 'settings/sharing', 'settings/mcp', 'settings/account', 'settings/data', 'settings/history']);
  });

  it('keeps tab pages out of the section list', () => {
    const ids = areaPages('settings', all).map(page => page.id);
    for (const hidden of ['settings/bio', 'settings/webhooks', 'settings/notifications', 'settings/appearance']) expect(ids).not.toContain(hidden);
  });

  it('points every section tab at a route file', () => {
    const app = join(process.cwd(), 'src', 'app');
    for (const tabs of Object.values(SECTION_TABS)) for (const tab of tabs) expect(existsSync(join(app, ...tab.href.split('/').filter(Boolean), 'page.tsx')), tab.href).toBe(true);
  });

  it('moves the old Settings routes with a 308 target and keeps the chat channels sub-route', () => {
    expect(resolveRedirect('/settings/connections', '?select=1')).toBe('/settings/channels?select=1');
    expect(resolveRedirect('/settings/profiles', '')).toBe('/settings/channels/groups');
    expect(resolveRedirect('/settings/bio', '')).toBe('/settings/sharing/bio');
    expect(resolveRedirect('/settings/mcp', '?keyOffset=20')).toBe('/settings/integrations?keyOffset=20');
    expect(resolveRedirect('/settings/webhooks', '')).toBe('/settings/integrations/webhooks');
    expect(resolveRedirect('/settings/appearance', '')).toBe('/settings/account/appearance');
    expect(resolveRedirect('/settings/notifications', '')).toBe('/settings/account/notifications');
    expect(resolveRedirect('/settings/notifications/chat-channels', '')).toBe('/settings/account/notifications/chat-channels');
    // The profile operations endpoint is an API, not a screen, and keeps its address.
    expect(resolveRedirect('/settings/profiles/operations', '')).toBeNull();
  });

  it('ships English and French card copy with the same keys and no empty text', () => {
    expect(sectionsCopySchema.safeParse(sectionsCopy).success).toBe(true);
    const keys = (value: unknown, prefix = ''): string[] => typeof value === 'object' && value ? Object.entries(value).flatMap(([key, item]) => keys(item, `${prefix}${key}.`)) : [prefix];
    expect(keys(sectionsCopy.fr)).toEqual(keys(sectionsCopy.en));
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join();
    expect(placeholders(sectionsCopy.fr.channels.inUse)).toBe(placeholders(sectionsCopy.en.channels.inUse));
    expect(placeholders(sectionsCopy.fr.tabsLabel)).toBe(placeholders(sectionsCopy.en.tabsLabel));
  });
});
