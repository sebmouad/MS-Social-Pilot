'use server';
import { currentRootActor } from '@/server/config/access';
import { OperationError } from '@/lib/operation-error';
import { issueClientInvitation, listClientInvitations, revokeClientInvitation } from '../../server/client-invitations';

async function actorId() {
  const actor = await currentRootActor();
  if (!actor?.isInstanceOwner) throw new OperationError('forbidden', 'Installation-owner access is required.');
  return actor.id;
}
export async function reloadClientInvitations() { return listClientInvitations(await actorId()); }
export async function createClientInvitation(input: unknown) { return issueClientInvitation(await actorId(), input); }
export async function removeClientInvitation(input: unknown) { return revokeClientInvitation(await actorId(), input); }
