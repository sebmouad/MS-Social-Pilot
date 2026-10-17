import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { addTeamMember, getTeamDirectory, removeTeamMember, updateTeamMember } from './server/team';
import { TEAM_ROLES, type TeamActor } from './team';

/** Version-one team MCP page protocol; operational directory bounds belong to Root. */
const MAX_PAGE_ITEMS = 200;
const pageSchema = z.object({ offset: z.number().int().min(0).optional(), targetOffset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(MAX_PAGE_ITEMS).optional() }).strict();
const grantProperties = {
  role: { type: 'string', enum: TEAM_ROLES },
  allPages: { type: 'boolean', description: 'Access all current and future channels. Required true for owners and admins.' },
  targetIds: { type: 'array', items: { type: 'string' }, description: 'Exact channel IDs when allPages is false. Must be empty when allPages is true.' },
  confirmation: { type: 'string' },
};
export const teamToolDefinitions = [
  { name: 'list_workspace_team', description: 'Read current workspace members, roles, actual channel grants and assignable channels. Owners/admins only. Follow nextOffset and nextTargetOffset for separate bounded pages; these are live reads, not a snapshot. No credentials or invitation tokens.', inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, targetOffset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_ITEMS } }, additionalProperties: false } },
  { name: 'add_workspace_member', description: 'Give an existing active account workspace access. Does not create an account or send mail. Confirmation: ADD MEMBER <trimmed lowercase email>. Channel grants and owner role rules are rechecked by the same service as the app.', inputSchema: { type: 'object', required: ['email', 'role', 'targetIds', 'allPages', 'confirmation'], properties: { email: { type: 'string' }, ...grantProperties }, additionalProperties: false } },
  { name: 'update_workspace_member', description: 'Change a member role and complete channel grant selection. Confirmation: UPDATE MEMBER <membershipId>. Only owners can manage owner roles; self role changes are refused. Owners/admins always have all-channel access.', inputSchema: { type: 'object', required: ['membershipId', 'role', 'targetIds', 'allPages', 'confirmation'], properties: { membershipId: { type: 'string' }, ...grantProperties }, additionalProperties: false } },
  { name: 'remove_workspace_member', description: 'Remove workspace access; retain their account, authored data and other workspace memberships. Confirmation: REMOVE MEMBER <membershipId>. Self removal and removal of the final active owner are refused.', inputSchema: { type: 'object', required: ['membershipId', 'confirmation'], properties: { membershipId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
];
export const teamWriteTools = new Set(['add_workspace_member', 'update_workspace_member', 'remove_workspace_member']);
export const teamTools = new Set(teamToolDefinitions.map(tool => tool.name));

export async function executeTeamTool(actor: TeamActor, name: string, args: Record<string, unknown>, cap: number) {
  if (name === 'add_workspace_member') return addTeamMember(actor, args);
  if (name === 'update_workspace_member') return updateTeamMember(actor, args);
  if (name === 'remove_workspace_member') return removeTeamMember(actor, args);
  if (name !== 'list_workspace_team') throw new OperationError('invalid_request', 'Unknown team action.');
  const checked = pageSchema.safeParse(args);
  if (!checked.success) throw new OperationError('invalid_request', 'Choose valid team paging values.');
  if (!Number.isSafeInteger(cap) || cap < 1) throw new OperationError('unavailable', 'Team results are temporarily unavailable.');
  const limit = Math.min(checked.data.limit ?? cap, cap, MAX_PAGE_ITEMS);
  const offset = checked.data.offset ?? 0;
  const targetOffset = checked.data.targetOffset ?? 0;
  const directory = await getTeamDirectory(actor);
  const members = directory.members.slice(offset, offset + limit);
  const targets = directory.targets.slice(targetOffset, targetOffset + limit);
  return { ...directory, members, targets, offset, targetOffset, limit,
    hasMore: offset + members.length < directory.total,
    totalTargets: directory.targets.length,
    nextOffset: offset + members.length < directory.total ? offset + members.length : null,
    nextTargetOffset: targetOffset + targets.length < directory.targets.length ? targetOffset + targets.length : null,
  };
}
