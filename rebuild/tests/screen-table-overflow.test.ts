import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { DataTable } from '@/components/DataTable';
import { TeamControls } from '@/modules/settings/ui/team/TeamControls';
import { InvitationControls } from '@/modules/settings/ui/team/InvitationControls';
import { SettingsPage, SettingsPanel } from '@/modules/settings/ui/_components';
import ads from '@/modules/analytics/ad-objects/screen.module.css';
import posts from '@/modules/analytics/explorer-posts/screen.module.css';
import reports from '@/modules/analytics/ui/reports/workflows.module.css';
import team from '@/modules/settings/ui/team/team.module.css';
import invitations from '@/modules/settings/ui/team/invitations.module.css';
import settings from '@/modules/settings/ui/settings.module.css';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));

const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: { document: Document } } };

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const modules: [string, Record<string, string>][] = [
  ['modules/analytics/ad-objects/screen.module.css', ads], ['modules/analytics/explorer-posts/screen.module.css', posts],
  ['modules/analytics/ui/reports/workflows.module.css', reports], ['modules/settings/ui/team/team.module.css', team],
  ['modules/settings/ui/team/invitations.module.css', invitations], ['modules/settings/ui/settings.module.css', settings],
];
const css = read('styles/tokens.css') + modules.map(([path, names]) => read(path)
  .replace(/\.([a-zA-Z_][\w-]*)/g, (match, name: string) => names[name] ? `.${names[name]}` : match)
  .replace(/:global\(([^)]+)\)/g, '$1')).join('\n');
const long = 'SyntheticLongResourceName'.repeat(12);
function fixtures(locale: 'en' | 'fr') {
  const table = h(DataTable, { caption: locale === 'fr' ? 'Mesures enregistrées' : 'Stored measures', rows: ['row'], rowKey: String,
    columns: Array.from({ length: 10 }, (_, i) => ({ key: String(i), label: `Measure ${i}`, render: () => long })) });
  const controls = [
    h(TeamControls, { key: 'members', locale, actorId: 'u', actorRole: 'admin', members: [{ id: 'm', userId: 'v', name: long, email: `${long}@example.test`, role: 'viewer', allPages: false, targetIds: [] }], targets: [] }),
    h(InvitationControls, { key: 'invites', locale, actorRole: 'admin', available: true, invitations: [{ id: 'i', email: `${long}@example.test`, role: 'viewer', status: 'pending', createdAt: '2026-10-01T00:00:00Z', expiresAt: '2099-10-24T00:00:00Z', acceptedAt: null }] }),
  ];
  return [
    ...[ads, posts].map(styles => h('div', { className: `${reports.root} ${styles.content}` }, h('h1', null, long), table,
      h('details', { open: true }, h('summary', null, 'Daily details'), table))),
    h(SettingsPage, { active: 'settings/team', title: 'Team', locale, description: 'Manage workspace members and invitations.', children: h(SettingsPanel, { title: 'Members', children: controls }) }),
  ].map(node => renderToStaticMarkup(node));
}

it('retains named, focusable table regions in both locales, including nested details and team invitations', () => {
  for (const locale of ['en', 'fr'] as const) for (const html of fixtures(locale)) {
    const document = new JSDOM(html).window.document;
    expect(document.querySelectorAll('table').length).toBe(2);
    for (const table of document.querySelectorAll('table')) {
      const region = table.closest('[role="region"]');
      expect(region?.getAttribute('tabindex')).toBe('0');
      expect(region?.getAttribute('aria-label')).toBeTruthy();
    }
  }
});

it('constrains each screen grid and its table wrapper without clipping the page', () => {
  for (const folder of ['ad-objects', 'explorer-posts']) {
    expect(read(`modules/analytics/${folder}/Screen.tsx`)).toContain('${styles.root} ${local.content}');
  }
  for (const [path] of modules.filter(([path]) => !path.includes('reports/') && !path.endsWith('ui/settings.module.css'))) {
    const source = read(path);
    expect(source).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(source).toMatch(/(?:ui-table-wrap\)|\.tableWrap)[^{]*\{[^}]*min-width: 0;[^}]*max-width: 100%/);
  }
});

it('gives team roots zero intrinsic inline size so the shared auto settings grid track cannot widen the page', () => {
  for (const path of ['modules/settings/ui/team/team.module.css', 'modules/settings/ui/team/invitations.module.css']) {
    expect(read(path)).toMatch(/^\.(?:team|invitations) \{[^}]*contain: inline-size;/m);
  }
});

// Opt-in real layout evidence using installed Chromium; no app server or DB.
it.skipIf(process.env.OVERFLOW_BROWSER_CHECK !== '1')('keeps synthetic table/form layouts within the viewport in Chromium', async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const locale of ['en', 'fr'] as const) for (const html of fixtures(locale)) {
      for (const theme of ['grove', 'coast', 'clay', 'nightfall']) for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(`<html data-theme="${theme}"><head><style>${css}
          body { margin: 0; } main { margin-left: 336px; min-width: 0; padding: 24px; }
          @media (max-width: 1023px) { main { margin-left: 0; padding: 16px; } }
          </style></head><body><main>${html}</main></body></html>`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}/${theme}/${width}`).toBe(true);
        for (const region of await page.locator('[role="region"]').all()) {
          await region.focus();
          expect(await region.evaluate(node => node === document.activeElement)).toBe(true);
          expect(await region.evaluate(node => getComputedStyle(node).overflowX)).toBe('auto');
          if (await region.evaluate(node => node.scrollWidth > node.clientWidth)) {
            expect(await region.evaluate(node => { node.scrollLeft = 100; return node.scrollLeft; })).toBeGreaterThan(0);
          }
        }
      }
    }
  } finally { await browser.close(); }
}, 60000);
