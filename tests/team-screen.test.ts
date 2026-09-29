import { describe, expect, it, vi } from 'vitest';

/**
 * The team screen and the last-resort error page, as rendered markup.
 *
 * What is asserted here is what a reader gets before touching anything: which
 * warnings are on screen, and whether each control can be told apart from its
 * neighbours by a screen reader. The behaviour on click — confirmation, the
 * pending lock, a dropped request — is walked in e2e/account.spec.ts.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock('next-intl', async () => {
  const messages = (await import('../messages/en.json')).default as unknown as Record<string, unknown>;
  const lookup = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

  return {
    useTranslations: (namespace: string) => (key: string, params: Record<string, string> = {}) => {
      const found = lookup(`${namespace}.${key}`);
      if (typeof found !== 'string') throw new Error(`missing message ${namespace}.${key}`);
      return found.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
    },
  };
});

const MEMBERS = [
  { userId: 'u1', name: 'Wren', email: 'wren@example.test', role: 'owner', isSelf: true },
  { userId: 'u2', name: 'Ada', email: 'ada@example.test', role: 'editor', isSelf: false },
  { userId: 'u3', name: 'Bo', email: 'bo@example.test', role: 'contributor', isSelf: false },
];

async function renderTeam(emailConfigured: boolean): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { TeamClient } = await import('../src/components/TeamClient');

  return renderToStaticMarkup(
    createElement(TeamClient, {
      members: MEMBERS,
      invitations: [{ id: 'i1', email: 'cy@example.test', role: 'editor', expiresLabel: 'in 7 days' }],
      canManage: true,
      viewerRole: 'owner',
      emailConfigured,
    }),
  );
}

describe('the team screen', () => {
  it('says email is off before an invitation is sent, not only after', async () => {
    const html = await renderTeam(false);
    const note = html.indexOf('Email is not configured on this server');

    expect(note).toBeGreaterThan(-1);
    // Inside the invite section, ahead of the button that sends one.
    expect(note).toBeLessThan(html.indexOf('Send invitation'));
  });

  it('does not warn about email when it is configured', async () => {
    expect(await renderTeam(true)).not.toContain('Email is not configured');
  });

  it('names every per-person control after the person', async () => {
    const html = await renderTeam(true);

    // Three rows of "Remove" and a column of unlabeled role menus are one
    // control repeated, as far as a screen reader can tell.
    expect(html).toContain('aria-label="Role for Ada"');
    expect(html).toContain('aria-label="Remove Bo"');
    expect(html).toContain('aria-label="Revoke the invitation for cy@example.test"');
  });

  it('offers no controls over the viewer themself', async () => {
    const html = await renderTeam(true);
    expect(html).not.toContain('aria-label="Role for Wren"');
    expect(html).not.toContain('aria-label="Remove Wren"');
  });
});

describe('the last-resort error page', () => {
  it('speaks both languages, since it cannot know which one the reader has', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { default: GlobalError } = await import('../src/app/global-error');

    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    const html = renderToStaticMarkup(createElement(GlobalError, { error, reset: () => {} }));

    expect(html).toContain('Something went wrong');
    expect(html).toMatch(/lang="fr"[^>]*>.*Une erreur est survenue/);
    expect(html).toContain('abc123');
    // And never the error's own message, which can carry anything.
    expect(html).not.toContain('boom');
  });
});
