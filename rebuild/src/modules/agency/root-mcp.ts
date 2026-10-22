import { OperationError } from '@/lib/operation-error';
import type { RootMcpActor } from '@/server/mcp/types';
import { listClientInvitations, issueClientInvitation, revokeClientInvitation } from './server/client-invitations';

const privateNote = ' Installation owner only, using a signed-in session. Workspace and person keys cannot use this tool.';
export const rootClientInvitationToolDefinitions = [
  { name: 'list_root_client_invitations', description: 'List safe legacy/new client invitations. No token hashes or one-use links.' + privateNote, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'invite_root_client', description: 'Invite a new client to create their own workspace. Requires enabled issuance policy. Confirmation: INVITE CLIENT followed by JSON.stringify([normalized lowercase email, trimmed workspace name or null]). Returns the private link only at creation and an explicit mail delivery status.' + privateNote, inputSchema: { type: 'object', required: ['email', 'confirmation'], properties: { email: { type: 'string' }, workspaceName: { type: 'string' }, locale: { type: 'string', enum: ['en', 'fr'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'revoke_root_client_invitation', description: 'Revoke an unaccepted client invitation. Confirmation: REVOKE CLIENT INVITATION <id>. Cannot remove an accepted account.' + privateNote, inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
];
export const rootClientInvitationTools = new Set(rootClientInvitationToolDefinitions.map(tool => tool.name));
export const rootClientInvitationResources = [{ uri: 'msp://root/client-invitations', name: 'Client invitations', description: 'Private client invitations without credentials.', tool: 'list_root_client_invitations' }];

/** Ready for installation-host aggregation; never register as customer Agency tools. */
export async function executeRootClientInvitationTool(actor: RootMcpActor, name: string, args: Record<string, unknown>) {
  if (!actor.isInstanceOwner || actor.apiKeyId || 'personKeyId' in actor || ('scope' in actor && actor.scope !== 'installation')) throw new OperationError('forbidden', 'Installation-owner session access is required.');
  if (name === 'list_root_client_invitations') {
    if (Object.keys(args).length) throw new OperationError('invalid_request', 'This directory does not accept filters.');
    const directory = await listClientInvitations(actor.userId);
    if (actor.maxResultItems !== undefined) {
      if (!Number.isSafeInteger(actor.maxResultItems) || actor.maxResultItems < 1) throw new OperationError('invalid_request', 'Invalid result limit.');
      return { ...directory, invitations: directory.invitations.slice(0, actor.maxResultItems), truncated: directory.truncated || directory.invitations.length > actor.maxResultItems };
    }
    return directory;
  }
  if (name === 'invite_root_client') return issueClientInvitation(actor.userId, args);
  if (name === 'revoke_root_client_invitation') return revokeClientInvitation(actor.userId, args);
  throw new OperationError('not_found', 'Unknown client invitation tool.');
}
