import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('../src/lib/prisma', () => ({ prisma: Object.fromEntries(['target', 'post', 'queueSlot', 'membership', 'shareLink', 'reportSchedule', 'apiToken'].map(key => [key, { count: async () => 0 }])) }));
vi.mock('../src/components/DismissibleCard', () => ({ DismissibleCard: ({ children }: { children: unknown }) => createElement('div', {}, children as never) }));
import { GettingStarted } from '../src/components/GettingStarted';
it('offers contributors only actions their role and modules allow', async () => {
  const html = renderToStaticMarkup(await GettingStarted({ workspaceId: 'test', developer: false, role: 'contributor', modules: ['schedule'], clientAccess: [] }));
  expect(html).toContain('href="/compose"');
  for (const route of ['/connections', '/queue', '/settings/team', '/settings/sharing', '/settings/api']) expect(html).not.toContain(`href="${route}"`);
});
it('does not invite viewers to create posts or owners into disabled modules', async () => {
  for (const role of ['viewer', 'owner'] as const) {
    const html = renderToStaticMarkup(await GettingStarted({ workspaceId: 'test', developer: false, role, modules: ['analytics'], clientAccess: [] }));
    expect(html).not.toContain('href="/compose"');
    expect(html).not.toContain('href="/queue"');
  }
});
