import { rootRoute, readBody, searchParamsObject } from '@/server/root/legacy/http';
import { listClientInvitations, issueClientInvitation, revokeClientInvitation } from './client-invitations';

/** Thin adapters for /api/root/client-invitations and /api/root/client-invitations/[id]. */
export const GET = rootRoute({}, async (request, actorId) => {
  searchParamsObject(request);
  return listClientInvitations(actorId);
});
export const POST = rootRoute({ write: true }, async (request, actorId) => issueClientInvitation(actorId, await readBody(request)));
export const DELETE = rootRoute<{ params: Promise<{ id: string }> }>({ write: true }, async (request, actorId, context) => {
  const { id } = await context.params;
  const input = await readBody(request);
  // The route id is part of the same exact confirmation, never a second scope.
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'confirmation')) {
    const { OperationError } = await import('@/lib/operation-error');
    throw new OperationError('invalid_request', 'Enter the exact invitation confirmation.');
  }
  return revokeClientInvitation(actorId, { id, ...input });
});
