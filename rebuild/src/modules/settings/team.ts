import { z } from 'zod';

export const TEAM_ROLES = ['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] as const;
export type TeamRole = typeof TEAM_ROLES[number];
export type TeamActor = { userId: string; workspaceId: string };

const identifier = z.string().min(1).max(255).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const targetIds = z.array(identifier).max(10000).refine(ids => new Set(ids).size === ids.length, 'Destinations must be unique.');
const role = z.enum(TEAM_ROLES);
const email = z.string().trim().max(320).email().transform(value => value.toLowerCase());
const scope = { targetIds, allPages: z.boolean() };

export const TEAM_ADD_MEMBER_SCHEMA = z.object({ email, role, ...scope, confirmation: z.string().max(400) }).strict().superRefine((value, context) => {
  if (value.allPages && value.targetIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetIds'], message: 'Choose all destinations or selected destinations.' });
});
export const TEAM_UPDATE_MEMBER_SCHEMA = z.object({ membershipId: identifier, role, ...scope, confirmation: z.string().max(400) }).strict().superRefine((value, context) => {
  if (value.allPages && value.targetIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetIds'], message: 'Choose all destinations or selected destinations.' });
});
export const TEAM_REMOVE_MEMBER_SCHEMA = z.object({ membershipId: identifier, confirmation: z.string().max(400) }).strict();

export type TeamMemberAddInput = z.infer<typeof TEAM_ADD_MEMBER_SCHEMA>;
export type TeamMemberUpdateInput = z.infer<typeof TEAM_UPDATE_MEMBER_SCHEMA>;
export type TeamMemberRemoveInput = z.infer<typeof TEAM_REMOVE_MEMBER_SCHEMA>;

export function addTeamConfirmation(canonicalEmail: string) { return `ADD MEMBER ${canonicalEmail.trim().toLowerCase()}`; }
export function updateTeamConfirmation(membershipId: string) { return `UPDATE MEMBER ${membershipId}`; }
export function removeTeamConfirmation(membershipId: string) { return `REMOVE MEMBER ${membershipId}`; }
