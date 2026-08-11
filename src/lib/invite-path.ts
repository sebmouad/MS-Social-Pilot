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
export function afterAuthPath(inviteToken?: string | null): string {
  return inviteToken ? `/invite/${encodeURIComponent(inviteToken)}` : '/dashboard';
}

/** Keep the invitation across the "sign in instead" / "create one" links. */
export function withInviteParam(path: string, inviteToken?: string | null): string {
  return inviteToken ? `${path}?invite=${encodeURIComponent(inviteToken)}` : path;
}
