import { describe, expect, it, vi } from 'vitest';

/**
 * Which roles the team screen offers, and to whom.
 *
 * The API refuses to grant or withdraw a role above the caller's own, and this
 * is the other half of that: an admin who is shown an "Owner" option in a
 * dropdown has been invited to click something that comes back a 403. Rendered
 * rather than reasoned about, because the bug would be in the markup.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock('next-intl', async () => {
  const messages = (await import('../messages/en.json')).default as unknown as Record<
    string,
    Record<string, unknown>
  >;
  return {
    useTranslations: (namespace: string) => (key: string) => {
      // The catalogue nests ("team.roles.owner"), so walk the dots.
      const found = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages[namespace]);
      return typeof found === 'string' ? found : `${namespace}.${key}`;
    },
  };
});

const OWNER = { userId: 'u1', name: 'Olivia', email: 'olivia@example.com', role: 'owner' };
const ADMIN = { userId: 'u2', name: 'Adam', email: 'adam@example.com', role: 'admin' };
const EDITOR = { userId: 'u3', name: 'Edie', email: 'edie@example.com', role: 'editor' };

async function render(viewerRole: string, viewerId: string): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { TeamClient } = await import('../src/components/TeamClient');

  return renderToStaticMarkup(
    createElement(TeamClient, {
      members: [OWNER, ADMIN, EDITOR].map((member) => ({ ...member, isSelf: member.userId === viewerId })),
      invitations: [],
      canManage: true,
      viewerRole,
      emailConfigured: true,
    }),
  );
}

/**
 * The markup of one member's row, and nothing after it.
 *
 * Bounded deliberately: a row with no dropdown of its own would otherwise
 * borrow the next member's, and the test would pass while the screen was
 * wrong.
 */
function rowFor(markup: string, name: string): string {
  const start = markup.indexOf(name);
  expect(start).toBeGreaterThan(-1);
  const end = markup.indexOf('</li>', start);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end);
}

/** The role options inside the select belonging to a given member row. */
function optionsForMember(markup: string, name: string): string[] {
  const row = rowFor(markup, name);
  if (!row.includes('<select')) return [];
  return [...row.matchAll(/value="([a-z]+)"/g)].map((match) => match[1]!);
}

describe('the roles the team screen offers', () => {
  it('does not offer an admin the owner role', async () => {
    const markup = await render('admin', ADMIN.userId);

    // Offering it would be an invitation to attempt an escalation the API
    // refuses — and the person clicking it has done nothing wrong.
    expect(optionsForMember(markup, 'Edie')).toEqual(['admin', 'editor', 'contributor', 'viewer']);
    expect(markup).not.toContain('value="owner"');
  });

  it('does not give an admin the controls for an owner', async () => {
    const markup = await render('admin', ADMIN.userId);

    // Olivia outranks the viewer: her row is read-only, with no dropdown and
    // no remove button beside it.
    expect(optionsForMember(markup, 'Olivia')).toEqual([]);
    expect(rowFor(markup, 'Olivia')).not.toContain('btn-danger');
  });

  it('lets an owner hand the role on', async () => {
    const markup = await render('owner', OWNER.userId);

    expect(optionsForMember(markup, 'Adam')).toEqual(['owner', 'admin', 'editor', 'contributor', 'viewer']);
  });

  it('never offers the client role to a team member', async () => {
    const markup = await render('owner', OWNER.userId);
    // A client is invited as one; a team member is never turned into one.
    expect(optionsForMember(markup, 'Edie')).not.toContain('client');
  });

  it('never offers owner on an invitation, whoever is looking', async () => {
    for (const viewer of ['owner', 'admin']) {
      const markup = await render(viewer, viewer === 'owner' ? OWNER.userId : ADMIN.userId);
      const select = markup.indexOf('id="inviteRole"');
      const end = markup.indexOf('</select>', select);
      const offered = [...markup.slice(select, end).matchAll(/value="([a-z]+)"/g)].map((m) => m[1]!);
      // An owner arrives by promotion, watched, not through an email link.
      expect(offered).not.toContain('owner');
    }
  });
});
