/**
 * Where to send someone once they have signed in or registered.
 *
 * Signing in is a detour on the way to accepting an invitation, so the token
 * has to survive the detour. The invitation page linked to `/register?invite=…`
 * and nothing read the parameter: a colleague accepting an invitation
 * registered, landed on the dashboard of a workspace they had not been invited
 * to, saw nothing about the invitation anywhere, and had to go back to the
 * email and click the link a second time.
 *
 * No imports on purpose — this is used by a client component, and pulling a
 * module with server dependencies into the browser bundle is how a database
 * client ends up shipped to a login page.
 */
export function afterAuthPath(inviteToken?: string | null, returnCookie?: string): string {
  if (inviteToken) return `/invite/${encodeURIComponent(inviteToken)}`;
  return (returnCookie !== undefined ? safeReturnPath(returnCookie) : takeReturnPath()) ?? '/dashboard';
}

/** Only an assistant's consent link may be returned to: never an outside address. */
export function safeReturnPath(raw: string): string | null {
  const path = decodeURIComponent(raw);
  return path.startsWith('/oauth/authorize?') ? path : null;
}

/** Set by the middleware when an assistant's consent link was opened signed out. */
export const RETURN_COOKIE = 'msp_return';

/** In the browser only: the remembered consent link; the consent answer clears it. */
function takeReturnPath(): string | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie.split('; ').find((part) => part.startsWith(`${RETURN_COOKIE}=`));
  if (!raw) return null;
  return safeReturnPath(raw.slice(RETURN_COOKIE.length + 1));
}

/** Keep the invitation across the "sign in instead" / "create one" links. */
export function withInviteParam(path: string, inviteToken?: string | null): string {
  return inviteToken ? `${path}?invite=${encodeURIComponent(inviteToken)}` : path;
}
