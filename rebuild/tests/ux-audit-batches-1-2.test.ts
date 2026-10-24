import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '../src/components/AppShell';
import { ChannelScopeList } from '../src/components/ChannelScopeList';
import { CsvExportButton } from '../src/components/CsvExportButton';
import { uiCopy } from '../src/modules/agency/ui/copy';
import { ChannelCardActions } from '../src/modules/settings/ui/connections/row-menu';
import { SHELL_COPY, SHELL_POLICY, type ShellCopy, type ShellPolicy } from '../src/modules/shell/copy';

const nav = vi.hoisted(() => ({ path: '/tasks', search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const copy = SHELL_COPY.en as unknown as ShellCopy;
const policy = SHELL_POLICY as unknown as ShellPolicy;
const channels = [
  { id: 'c1', name: 'North Market', pictureUrl: null, health: 'connected' as const },
  { id: 'c2', name: 'South Market', pictureUrl: null, health: 'expired' as const },
];

describe('UX Audit 2026-10-24 — Batch 1 & Batch 2 regressions', () => {
  it('only highlights "All channels" in ChannelScopeList when scopeActive is true', () => {
    const activeHtml = renderToStaticMarkup(
      createElement(ChannelScopeList, {
        channels,
        selectedIds: [],
        scopeActive: true,
        collapsedCount: 5,
        searchThreshold: 8,
        onSelect: vi.fn(),
        onReset: vi.fn(),
      }),
    );
    expect(activeHtml).toContain('ui-scope__item is-selected');

    const inactiveHtml = renderToStaticMarkup(
      createElement(ChannelScopeList, {
        channels,
        selectedIds: [],
        scopeActive: false,
        collapsedCount: 5,
        searchThreshold: 8,
        onSelect: vi.fn(),
        onReset: vi.fn(),
      }),
    );
    expect(inactiveHtml).not.toContain('ui-scope__item is-selected');
  });

  it('always renders the active optional area tab in AppShell even when optionalAreas omits it, and un-highlights All channels on non-channel-scoped areas', () => {
    nav.path = '/tasks';
    const html = renderToStaticMarkup(
      createElement(AppShell, {
        activeModule: 'tasks',
        optionalAreas: [],
        enabledModules: ['home', 'publishing', 'tasks', 'inbox', 'analytics', 'ads', 'settings'],
        enabledFeatures: ['home/overview', 'publishing/posts', 'publishing/calendar', 'tasks/board', 'settings/account'],
        writableFeatures: ['publishing/posts', 'tasks/board'],
        rootAccess: false,
        userName: 'Preview',
        workspaceName: 'Example workspace',
        workspaceId: 'w1',
        copy,
        policy,
        channels,
        children: createElement('div', null, 'Tasks content'),
      }),
    );
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('ui-scope__item is-selected');
  });

  it('supports singular and plural nouns in Agency copy catalog (EN & FR)', () => {
    const tEn = uiCopy('en');
    expect(tEn('channel cannot publish')).toBe('channel cannot publish');
    expect(tEn('channels cannot publish')).toBe('channels cannot publish');
    expect(tEn('failed post')).toBe('failed post');
    expect(tEn('failed posts')).toBe('failed posts');
    expect(tEn('overdue task')).toBe('overdue task');
    expect(tEn('overdue tasks')).toBe('overdue tasks');

    const tFr = uiCopy('fr');
    expect(tFr('channel cannot publish')).toBe('canal ne peut pas publier');
    expect(tFr('channels cannot publish')).toBe('canaux ne peuvent pas publier');
    expect(tFr('failed post')).toBe('publication en échec');
    expect(tFr('failed posts')).toBe('publications en échec');
    expect(tFr('overdue task')).toBe('tâche en retard');
    expect(tFr('overdue tasks')).toBe('tâches en retard');
  });

  it('renders Reconnect as a secondary button in ChannelCardActions so Manage selections stays primary', () => {
    const html = renderToStaticMarkup(
      createElement(ChannelCardActions, {
        id: 'src-1',
        name: 'North Market',
        platformId: 'facebook',
        needsReconnect: true,
        manageLabel: 'Manage selections',
        disconnectLabel: 'Disconnect',
        actionsLabel: 'Actions',
        reconnectLabel: 'Reconnect',
        busyLabel: 'Reconnecting…',
        failedLabel: 'Could not reconnect',
      }),
    );
    expect(html).toContain('ui-button--secondary');
    expect(html).not.toContain('ui-button--primary');
  });

  it('places the CsvExportButton disclaimer behind an InfoTip while preserving accessible text', () => {
    const html = renderToStaticMarkup(
      createElement(CsvExportButton, {
        href: '/api/ads/export',
        expectedFormat: 'text/csv',
        rowCountHeader: 'x-export-rows',
        maxRows: 5000,
        maxBytes: 1000000,
        fileName: 'ads-export.csv',
        copy: {
          heading: 'Export',
          action: 'Export CSV',
          pending: 'Preparing…',
          help: 'Exports all matching daily rows.',
          noun: { singular: 'row', plural: 'rows' },
        },
      }),
    );
    expect(html).toContain('Export CSV');
    expect(html).toContain('ui-infotip');
    expect(html).toContain('Exports all matching daily rows.');
  });
});
