export type TwoStepPolicy = 'off' | 'admins' | 'everyone';

/** A workspace role is privileged even before the first channel is connected. */
export function needsTwoStepEnrollment(policy: TwoStepPolicy, isInstanceOwner: boolean, workspaceRoles: readonly string[]): boolean {
  if (policy === 'everyone') return true;
  if (policy === 'off') return false;
  return isInstanceOwner || workspaceRoles.some(role => role === 'owner' || role === 'admin');
}
