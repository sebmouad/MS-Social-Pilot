import { OperationError } from '@/lib/operation-error';
import { AGENCY_SORTS, type AgencyActor } from './agency';
import { exportAgencyOverview } from './server/export';
import { agencyOverview, listAgencyClients } from './server/agency';

/**
 * Agency reads span every workspace one person administers. A workspace-scoped MCP key is bound to one
 * workspace and must never reach them, so these tools are NOT part of the workspace tool catalog and
 * `executeAgencyTool` accepts only an explicit person principal. The separate person dispatcher
 * validates person credentials and enforces its overview-only ceiling before entering here.
 */
export type AgencyPersonPrincipal = { scope: 'person'; userId: string };

export const agencyTools = new Set(['get_agency_overview', 'list_agency_clients']);
export const agencyWriteTools = new Set<string>();
export const agencyToolDefinitions = [
  { name: 'get_agency_overview', description: 'Compare the workspaces you own or administer: channels, delivery problems, scheduled and failed posts, open and overdue tasks. Other workspaces are never included. Optional format packages the same filtered, bounded overview as CSV or JSON with coverage and truncation disclosure.', inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 200 }, sort: { type: 'string', enum: [...AGENCY_SORTS] }, order: { type: 'string', enum: ['asc', 'desc'] }, attentionOnly: { type: 'boolean' }, format: { type: 'string', enum: ['csv', 'json'] }, locale: { type: 'string', enum: ['en', 'fr'] } }, additionalProperties: false } },
  { name: 'list_agency_clients', description: 'List client accounts and pending client invitations in workspaces you own or administer.', inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 200 } }, additionalProperties: false } },
];

/** Refuses anything that is workspace-bound, key-backed or not an exact person principal. */
export function agencyActorFor(identity: unknown): AgencyActor {
  const value = identity && typeof identity === 'object' ? identity as Record<string, unknown> : {};
  const forbiddenKeys = ['apiKeyId', 'personKeyId', 'readFeature', 'workspaceId', 'workspace', 'permissions', 'isInstanceOwner'];
  if (value.scope !== 'person' || typeof value.userId !== 'string' || !value.userId || forbiddenKeys.some(key => key in value)) {
    throw new OperationError('forbidden', 'Agency tools are available only to a signed-in person, not to a workspace key.');
  }
  return { userId: value.userId };
}

export async function executeAgencyTool(identity: unknown, name: string, args: Record<string, unknown>) {
  const actor = agencyActorFor(identity);
  if (name === 'get_agency_overview') return 'format' in args ? exportAgencyOverview(actor, args) : agencyOverview(actor, args);
  if (name === 'list_agency_clients') return listAgencyClients(actor, args);
  throw new OperationError('invalid_request', 'Unknown agency tool.');
}
