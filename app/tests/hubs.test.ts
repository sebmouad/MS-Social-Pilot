import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ config: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), channels: vi.fn(), queryRaw: vi.fn(), inboxAccess: vi.fn(), reportAccess: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/server/entitlements', () => ({
  loadEntitlements: mocks.entitlements,
  canUseModule: (_e: unknown, id: string) => !deniedModules.has(id),
  canUseFeature: (_e: unknown, id: string) => !deniedFeatures.has(id),
}));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/permissions', () => ({
  canAccessModule: (_p: unknown, id: string) => !deniedModules.has(id),
  canAccessFeature: (_p: unknown, id: string, action = 'read') => !deniedFeatures.has(id) && (action !== 'write' || !deniedWrite.has(id)),
}));
vi.mock('@/modules/shell/server/channels', () => ({ shellChannels: mocks.channels }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: mocks.inboxAccess }));
vi.mock('@/modules/analytics/reports/server/access', () => ({ authorizeReport: mocks.reportAccess }));

const deniedModules = new Set<string>();
const deniedFeatures = new Set<string>();
const deniedWrite = new Set<string>();

import { HUB_ORDER, hubForPage, hubForPath, hubPages } from '../src/lib/hubs';
import { PAGES } from '../src/lib/product';
import { badgeText } from '../src/components/AppShell';
import { SHELL_COPY, fill, resolveShellCopy, shellCopySchema } from '../src/modules/shell/copy';
import { COMMAND_COPY, commandCopySchema, resolveCommandCopy } from '../src/modules/home/command-copy';
import { listPaletteTargets } from '../src/modules/home/server/commands';
import { openMentionCount } from '../src/modules/inbox/server/mentions-badge';
import { openAlertCount } from '../src/modules/analytics/alerts/server/alerts-badge';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const ALL_FEATURES = PAGES.map(page => page.id);

beforeEach(() => {
  vi.clearAllMocks();
  deniedModules.clear(); deniedFeatures.clear(); deniedWrite.clear();
  mocks.config.mockImplementation(async (key: string) => {
    if (key === 'home.commandPaletteLimit') return 100;
    if (key === 'inbox.mentionPrefix') return '@';
    throw new Error(`unregistered ${key}`);
  });
  mocks.entitlements.mockResolvedValue({ workspaceId: 'workspace-a' });
  mocks.permissions.mockResolvedValue({ pageScope: { all: true, ids: [] } });
  mocks.channels.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([{ count: 0 }]);
  mocks.inboxAccess.mockResolvedValue({ channelIds: ['c1'] });
  mocks.reportAccess.mockResolvedValue({ scope: null });
});

describe('hub navigation (UI wave 1)', () => {
  it('orders the five hubs Create, Plan, Engage, Measure, Grow', () => {
    expect(HUB_ORDER).toEqual(['create', 'plan', 'engage', 'measure', 'grow']);
  });

  it('places every page in exactly one hub, except the Home landing and Settings', () => {
    for (const page of PAGES) {
      const hub = hubForPage(page);
      if (page.area === 'home' || page.area === 'settings') expect(hub, page.id).toBeUndefined();
      else expect(hub, page.id).toMatch(/^(create|plan|engage|measure|grow)$/);
    }
    expect(PAGES.filter(page => hubForPage(page) === 'create').map(page => page.id).sort()).toEqual(['studio/agents', 'studio/ai-studio']);
    expect(PAGES.filter(page => hubForPage(page) === 'plan').map(page => page.id)).toContain('tasks/board');
    expect(PAGES.filter(page => hubForPage(page) === 'grow').map(page => page.id)).toEqual(expect.arrayContaining(['agency/clients', 'agency/overview']));
  });

  it('resolves hub paths without changing any URL', () => {
    expect(hubForPath('/create', 'publishing')).toBe('create');
    expect(hubForPath('/content/ai-studio')).toBe('create');
    expect(hubForPath('/content')).toBe('plan');
    expect(hubForPath('/content/post/abc')).toBe('plan');
    expect(hubForPath('/content/calendar')).toBe('plan');
    expect(hubForPath('/tasks')).toBe('plan');
    expect(hubForPath('/inbox')).toBe('engage');
    expect(hubForPath('/insights')).toBe('measure');
    expect(hubForPath('/insights/tests')).toBe('measure');
    expect(hubForPath('/ads')).toBe('grow');
    expect(hubForPath('/ads/analysis')).toBe('grow');
    expect(hubForPath('/agency/clients')).toBe('grow');
    expect(hubForPath('/home')).toBeUndefined();
    expect(hubForPath('/settings/team')).toBeUndefined();
    expect(hubForPath('/root')).toBeUndefined();
  });

  it('builds hub tabs from their areas: studio leaves Plan for Create, tasks and agency join only when used', () => {
    const plan = hubPages('plan', ALL_FEATURES, []);
    expect(plan.map(page => page.href)).toEqual(['/content', '/content/calendar', '/content/queue', '/content/approvals', '/content/library', '/content/feeds']);
    expect(hubPages('plan', ALL_FEATURES, ['tasks']).map(page => page.href)).toContain('/tasks');
    expect(hubPages('create', ALL_FEATURES, []).map(page => page.href)).toEqual(['/content/ai-studio', '/content/agents']);
    expect(hubPages('engage', ALL_FEATURES, []).map(page => page.href)).toEqual(['/inbox']);
    expect(hubPages('measure', ALL_FEATURES, []).map(page => page.href)).toEqual(['/insights', '/insights/explore', '/insights/audience', '/insights/posts', '/insights/tests', '/insights/compare', '/insights/reports']);
    expect(hubPages('grow', ALL_FEATURES, []).map(page => page.href)).toEqual(['/ads', '/ads/campaigns', '/ads/manage', '/ads/analysis', '/ads/compare']);
    expect(hubPages('grow', ALL_FEATURES, ['agency']).map(page => page.href)).toEqual(['/ads', '/ads/campaigns', '/ads/manage', '/ads/analysis', '/ads/compare', '/agency', '/agency/clients']);
  });

  it('hides hub tabs the member cannot use', () => {
    expect(hubPages('plan', ['publishing/posts'])).toHaveLength(1);
    expect(hubPages('measure', [])).toEqual([]);
  });

  it('caps badge text at 99+', () => {
    expect(badgeText(0)).toBe('0');
    expect(badgeText(3)).toBe('3');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('hub and palette copy', () => {
  it('names the hubs, hub tabs and hub badges in English and French with matching placeholders', () => {
    expect(shellCopySchema.safeParse(SHELL_COPY).success).toBe(true);
    expect(SHELL_COPY.en.hubs).toEqual({ create: 'Create', plan: 'Plan', engage: 'Engage', measure: 'Measure', grow: 'Grow' });
    expect(Object.keys(SHELL_COPY.fr.hubs)).toEqual(Object.keys(SHELL_COPY.en.hubs));
    expect(Object.keys(SHELL_COPY.fr.hubCounts)).toEqual(Object.keys(SHELL_COPY.en.hubCounts));
    expect(fill(SHELL_COPY.en.hubTabsLabel, { hub: 'Plan' })).toBe('Plan sections');
    expect(fill(SHELL_COPY.fr.hubCounts.plan, { count: 2 })).toContain('2');
  });

  it('fills hub labels for catalogs saved before wave 1 without losing operator edits', () => {
    const saved = structuredClone(SHELL_COPY) as unknown as Record<string, Record<string, unknown>>;
    for (const locale of ['en', 'fr'] as const) { delete saved[locale]!.hubs; delete saved[locale]!.hubTabsLabel; delete saved[locale]!.hubCounts; }
    saved.en!.filter = 'Narrow down';
    const resolved = resolveShellCopy(saved);
    expect(resolved.en.filter).toBe('Narrow down');
    expect(resolved.en.hubs).toEqual(SHELL_COPY.en.hubs);
    expect(resolved.fr.hubCounts).toEqual(SHELL_COPY.fr.hubCounts);
    expect(shellCopySchema.safeParse(resolved).success).toBe(true);
  });

  it('titles the three palette sections in both languages', () => {
    expect(commandCopySchema.safeParse(COMMAND_COPY).success).toBe(true);
    expect(Object.keys(COMMAND_COPY.fr)).toEqual(Object.keys(COMMAND_COPY.en));
    expect(COMMAND_COPY.en.sectionActions).toBe('Create');
    expect(COMMAND_COPY.en.sectionPages).toBe('Pages');
    expect(COMMAND_COPY.en.sectionChannels).toBe('Channels');
  });

  it('fills palette sections for catalogs saved before wave 1 without losing operator edits', () => {
    const saved = { en: { trigger: 'Find…', placeholder: 'Find…', noResults: 'None.', hint: 'Type.', close: 'Close' }, fr: { ...COMMAND_COPY.fr } };
    delete (saved.fr as Record<string, unknown>).sectionChannels;
    expect(commandCopySchema.safeParse(saved).success).toBe(false);
    const resolved = resolveCommandCopy(saved);
    expect(resolved.en.trigger).toBe('Find…');
    expect(resolved.en.sectionActions).toBe(COMMAND_COPY.en.sectionActions);
    expect(resolved.fr.sectionChannels).toBe(COMMAND_COPY.fr.sectionChannels);
    expect(commandCopySchema.safeParse(resolved).success).toBe(true);
    expect(resolveCommandCopy('garbage')).toEqual({ en: COMMAND_COPY.en, fr: COMMAND_COPY.fr });
  });
});

describe('command-bar targets', () => {
  it('offers the sidebar Create action only to members who may write', async () => {
    const { actions } = await listPaletteTargets(actor);
    expect(actions).toEqual([{ id: 'create-publishing', title: 'New post', href: '/create' }]);
    deniedWrite.add('publishing/posts');
    expect((await listPaletteTargets(actor)).actions).toEqual([]);
    deniedWrite.clear(); deniedFeatures.add('publishing/posts');
    expect((await listPaletteTargets(actor)).actions).toEqual([]);
  });

  it('jumps to channels through the shared scope parameter with their health', async () => {
    mocks.channels.mockResolvedValue([
      { id: 'c1', name: 'North Market', pictureUrl: null, platformName: 'Facebook', health: 'connected' },
      { id: 'c2', name: 'South Market', pictureUrl: null, platformName: 'Instagram', health: 'expired' },
    ]);
    const { channels } = await listPaletteTargets(actor);
    expect(channels).toEqual([
      { id: 'c1', title: 'North Market', href: '/inbox?channel=c1', health: 'connected' },
      { id: 'c2', title: 'South Market', href: '/inbox?channel=c2', health: 'expired' },
    ]);
    expect(mocks.channels).toHaveBeenCalledWith('workspace-a', undefined, 50);
  });

  it('limits channel jumps to the member’s own channels and survives a failed lookup', async () => {
    mocks.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['c1'] } });
    await listPaletteTargets(actor);
    expect(mocks.channels).toHaveBeenCalledWith('workspace-a', ['c1'], 50);
    mocks.channels.mockRejectedValue(new Error('offline'));
    const { items, channels } = await listPaletteTargets(actor);
    expect(channels).toEqual([]);
    expect(items.length).toBeGreaterThan(0);
  });

  it('filters every group by the same search', async () => {
    mocks.channels.mockResolvedValue([{ id: 'c1', name: 'North Market', pictureUrl: null, platformName: 'Facebook', health: 'connected' }]);
    const found = await listPaletteTargets(actor, { q: 'north' });
    expect(found.channels).toHaveLength(1);
    expect(found.actions).toEqual([]);
    const missing = await listPaletteTargets(actor, { q: 'north' });
    expect(missing.items.every(item => `${item.title} ${item.moduleTitle} ${item.id}`.toLowerCase().includes('north'))).toBe(true);
    await expect(listPaletteTargets(actor, { q: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('hub badge counts', () => {
  it('counts open page mentions in the member’s channel scope', async () => {
    mocks.queryRaw.mockResolvedValue([{ count: 3 }]);
    await expect(openMentionCount(actor)).resolves.toBe(3);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('never lets a mention badge block a page', async () => {
    mocks.inboxAccess.mockResolvedValue({ channelIds: [] });
    await expect(openMentionCount(actor)).resolves.toBe(0);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    mocks.inboxAccess.mockResolvedValue({ channelIds: ['c1'] });
    mocks.config.mockResolvedValue('');
    await expect(openMentionCount(actor)).resolves.toBe(0);
    mocks.config.mockImplementation(async (key: string) => (key === 'inbox.mentionPrefix' ? '@' : 100));
    mocks.inboxAccess.mockRejectedValue(new Error('forbidden'));
    await expect(openMentionCount(actor)).resolves.toBe(0);
    mocks.inboxAccess.mockResolvedValue({ channelIds: ['c1'] });
    mocks.queryRaw.mockRejectedValue(new Error('offline'));
    await expect(openMentionCount(actor)).resolves.toBe(0);
  });

  it('counts open alert firings in the member’s channel scope', async () => {
    mocks.queryRaw.mockResolvedValue([{ count: 2 }]);
    await expect(openAlertCount(actor)).resolves.toBe(2);
    mocks.reportAccess.mockResolvedValue({ scope: [] });
    await expect(openAlertCount(actor)).resolves.toBe(0);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    mocks.reportAccess.mockRejectedValue(new Error('forbidden'));
    await expect(openAlertCount(actor)).resolves.toBe(0);
  });
});

describe('wave 1 tokens and shell styles', () => {
  const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
  const shell = readFileSync(join(process.cwd(), 'src/styles/shell.css'), 'utf8');
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const block = (theme: string, mode: string) => {
    const selector = mode === 'light' ? `:root[data-theme="${theme}"] {` : `:root[data-theme="${theme}"][data-mode="${mode}"] {`;
    const start = tokens.indexOf(selector);
    return tokens.slice(start, tokens.indexOf('}', start));
  };
  const token = (body: string, name: string) => body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

  it('keeps the accent-ladder text readable on its tint in every theme, mode and device match', () => {
    for (const theme of ['vivid', 'meta', 'warm', 'clean']) {
      for (const mode of ['light', 'dark', 'system']) {
        const body = block(theme, mode);
        const ink = token(body, 'accent-ink'), soft = token(body, 'accent-soft');
        expect(ink, `${theme} ${mode}: --accent-ink`).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(contrast(ink!, soft!), `${theme} ${mode}: --accent-ink on --accent-soft`).toBeGreaterThanOrEqual(4.5);
      }
      expect(token(block(theme, 'system'), 'accent-ink'), `${theme}: system matches dark`).toBe(token(block(theme, 'dark'), 'accent-ink'));
    }
  });

  it('takes the sheet geometry, section size and brand face', () => {
    const base = tokens.match(/:root\s*\{([^}]+)\}/)![1];
    expect(base).toContain('--sidebar-w: 230px');
    expect(base).toContain('--topbar-h: 48px');
    expect(base).toContain('--gutter: 24px');
    expect(base).toContain('--text-xl: 18px');
    expect(base).toContain('var(--font-brand)');
    expect(readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')).toContain("variable: '--font-brand'");
  });

  it('styles hubs as tint-active rows with count badges and grouped palette results', () => {
    expect(shell).toContain('.shell-hubs');
    expect(shell).toMatch(/\.shell-hub\.is-active \{[^}]*background: var\(--rail-active-bg\)/);
    expect(shell).toMatch(/\.shell-hub__badge \{[^}]*background: var\(--danger\)/);
    expect(shell).toContain('.ui-palette__group-label');
    expect(shell).toContain('.shell-workspace__menu');
    expect(shell).not.toContain('shell-area');
    expect(shell).toMatch(/\.ui-bottombar__item\.is-active \.ui-bottombar__glyph \{ background: var\(--accent-soft\)/);
  });
});
