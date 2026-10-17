import { z } from 'zod';
import { TEAM_ROLES, type TeamActor, type TeamRole } from './team';

export type { TeamActor, TeamRole };
export { TEAM_ROLES };

const email = z.string().trim().max(320).email().transform(value => value.toLowerCase());
const identifier = z.string().trim().min(1).max(255).refine(value => !/[\u0000-\u001f\u007f]/.test(value));

export const TEAM_INVITE_SCHEMA = z.object({
  email, role: z.enum(TEAM_ROLES), confirmation: z.string().max(400),
}).strict();
export const TEAM_INVITATION_REVOKE_SCHEMA = z.object({ id: identifier, confirmation: z.string().max(400) }).strict();
export const TEAM_INVITATION_REGISTRATION_SCHEMA = z.object({ token: z.string().min(1).max(128), name: z.string().trim().min(1).max(100), password: z.string().min(1).max(200), confirmation: z.string().max(400) }).strict();

export type TeamInviteInput = z.infer<typeof TEAM_INVITE_SCHEMA>;
export type TeamInvitationRevokeInput = z.infer<typeof TEAM_INVITATION_REVOKE_SCHEMA>;
export type TeamInvitationRegistrationInput = z.infer<typeof TEAM_INVITATION_REGISTRATION_SCHEMA>;
export type InvitationStatus = 'pending' | 'expired' | 'accepted';

export function inviteTeamConfirmation(canonicalEmail: string) { return `INVITE MEMBER ${canonicalEmail.trim().toLowerCase()}`; }
export function revokeTeamInvitationConfirmation(id: string) { return `REVOKE INVITATION ${id}`; }
