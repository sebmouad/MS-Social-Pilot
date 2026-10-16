import { beforeEach, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.actor }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('../src/components/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => createElement('main', null, children) }));
import Page from '../src/app/no-workspace/page';
beforeEach(() => { vi.clearAllMocks(); });
it('redirects anonymous users to sign in and installation owners to their private control center', async () => {
  state.actor.mockResolvedValueOnce(null);
  await expect(Page()).rejects.toThrow('redirect:/sign-in');
  state.actor.mockResolvedValueOnce({ id: 'root', isInstanceOwner: true });
  await expect(Page()).rejects.toThrow('redirect:/root');
});
it('gives a signed-in customer an invitation and sign-out recovery path without Root instructions', async () => {
  state.actor.mockResolvedValueOnce({ id: 'member', name: 'Member', isInstanceOwner: false });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('No workspace yet');
  expect(html).toContain('sign out from the menu');
  expect(html).not.toContain('/root');
});
