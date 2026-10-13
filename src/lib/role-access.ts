/**
 * Which screens and writes the two outside roles get (owner approved,
 * 2026-10-12): the viewer and the client. Every other role sees every screen
 * its capabilities allow; these two get a short list, the same in the
 * sidebar and on the server.
 *
 * Plain module: the sidebar imports it.
 */

/** What a workspace may open to its clients, beyond the calendar and approvals. */
export const CLIENT_SWITCHES = ['analytics', 'inbox', 'library'] as const;
export type ClientSwitch = (typeof CLIENT_SWITCHES)[number];

export function isClientSwitch(value: string): value is ClientSwitch {
  return (CLIENT_SWITCHES as readonly string[]).includes(value);
}

type Rule = { path: string; exact?: boolean };

const matches = (pathname: string, rule: Rule) =>
  pathname === rule.path || (!rule.exact && pathname.startsWith(`${rule.path}/`));

/** Everyone's own things: their account, sign-in, notifications, calendar feeds, exports. */
const PERSONAL_WRITES: Rule[] = [
  { path: '/api/account' },
  { path: '/api/auth' },
  { path: '/api/notifications' },
  { path: '/api/calendar-feeds' },
  { path: '/api/exports' },
];

const CLIENT_SCREENS: Record<'base' | ClientSwitch, Rule[]> = {
  base: [
    { path: '/calendar', exact: true },
    { path: '/posts' },
    { path: '/approvals' },
    { path: '/settings/account' },
    { path: '/settings/notifications' },
  ],
  analytics: [{ path: '/analytics' }, { path: '/reports' }],
  inbox: [{ path: '/inbox', exact: true }],
  library: [{ path: '/settings/media' }],
};

/** Writes a client may make beyond their own things: approving, and what a switch opens. */
const CLIENT_WRITES: Record<'base' | ClientSwitch, RegExp[]> = {
  base: [/^\/api\/posts\/[^/]+\/approve$/, /^\/api\/posts\/[^/]+\/notes(\/.*)?$/],
  analytics: [],
  inbox: [],
  library: [/^\/api\/media(\/.*)?$/],
};

/** Screens a viewer does not get: the ones that only exist to change things. */
const VIEWER_HIDDEN: Rule[] = [
  { path: '/compose' },
  { path: '/templates' },
  { path: '/design' },
  { path: '/queue/mix' },
  { path: '/inbox/replies' },
  { path: '/inbox/rules' },
  { path: '/settings/sharing' },
  { path: '/settings/bio' },
  { path: '/agency' },
];

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** May this role open this screen? Every role but viewer and client: yes, its own checks decide. */
export function mayOpenScreen(role: string, clientAccess: readonly string[], pathname: string): boolean {
  if (role === 'viewer') return !VIEWER_HIDDEN.some((rule) => matches(pathname, rule));
  if (role !== 'client') return true;
  return (['base', ...clientAccess.filter(isClientSwitch)] as const).some((key) => CLIENT_SCREENS[key].some((rule) => matches(pathname, rule)));
}

/** May this role make this signed-in API write? Reads are always left to the route. */
export function mayWrite(role: string, clientAccess: readonly string[], method: string, pathname: string): boolean {
  if (READS.has(method)) return true;
  if (role !== 'viewer' && role !== 'client') return true;
  if (PERSONAL_WRITES.some((rule) => matches(pathname, rule))) return true;
  if (role === 'viewer') return false;
  return (['base', ...clientAccess.filter(isClientSwitch)] as const).some((key) => CLIENT_WRITES[key].some((pattern) => pattern.test(pathname)));
}

/** Where each role lands after signing in, or when a screen is not theirs. */
export function homeFor(role: string): string {
  return role === 'client' ? '/calendar' : '/dashboard';
}
