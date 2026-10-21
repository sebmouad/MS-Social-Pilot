import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runtimeConfig } from '@/server/config/store';
import { lockRootActor, invalid, conflict } from '@/server/root/legacy/authz';
import { OperationError } from '@/lib/operation-error';
import { rootTransaction } from '@/server/root/legacy/policy';

type CreateInput = { name: string; ownerEmail: string; timezone?: string; confirmation: string };

function validTimezone(timezone: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); return true; } catch { return false; }
}

export async function createRootWorkspace(actorId: string, input: CreateInput) {
  const parsed = z.object({ name: z.string().trim().min(1), ownerEmail: z.string().trim().toLowerCase().email(), timezone: z.string().optional(), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success) throw invalid('Enter a workspace name, owner email and exact confirmation.');
  input = parsed.data;
  const name = input.name.trim();
  const timezone = input.timezone ?? await runtimeConfig('root.defaultWorkspaceTimezone');
  await validateWorkspaceInput(name, input.confirmation);
  if (input.ownerEmail.length > await runtimeConfig('root.emailMaxCharacters')) throw invalid('Choose a valid owner email.');
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!name) throw invalid('Enter a workspace name.');
  if (!validTimezone(timezone)) throw invalid('Choose a valid timezone.');
  if (input.confirmation !== `CREATE ${name} FOR ${ownerEmail}`) throw invalid('Enter the exact confirmation shown.');
  const id = randomUUID();
  const base = name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
  const slug = `${base}-${id}`;
  return rootTransaction(async tx => {
    await lockRootActor(tx, actorId);
    const owner = await tx.user.findUnique({ where: { email: ownerEmail }, select: { id: true, email: true, disabledAt: true } });
    if (!owner || owner.disabledAt) throw invalid('Choose an existing active account as owner.');
    const workspace = await tx.workspace.create({ data: { id, name, slug, timezone, memberships: { create: { id: randomUUID(), userId: owner.id, role: 'owner' } } }, select: { id: true, slug: true } });
    const detail = JSON.stringify({ workspaceId: workspace.id, ownerId: owner.id });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${'root.workspace_created'}, ${detail}::jsonb, NOW())`;
    return workspace;
  });
}

export async function renameRootWorkspace(actorId: string, workspaceId: string, nameInput: string, confirmation: string) {
  if (typeof nameInput !== 'string' || typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > await runtimeConfig('root.identifierMaxCharacters')) throw invalid('Choose a valid workspace and name.');
  const name = nameInput.trim();
  await validateWorkspaceInput(name, confirmation);
  if (!name) throw invalid('Enter a workspace name.');
  return rootTransaction(async tx => {
    await lockRootActor(tx, actorId);
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true, dataPurge: { select: { status: true } } } });
    if (!workspace) throw new OperationError('not_found', 'Workspace not found.');
    if (workspace.dataPurge) throw conflict('Workspace deletion is in progress.');
    if (confirmation !== `RENAME ${workspace.name} TO ${name}`) throw invalid('Enter the exact confirmation shown.');
    if (name === workspace.name) return { changed: false };
    const result = await tx.workspace.updateMany({ where: { id: workspaceId, name: workspace.name }, data: { name } });
    if (result.count !== 1) throw conflict('Workspace changed; reload and try again.');
    const detail = JSON.stringify({ workspaceId, previousName: workspace.name, name });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${'root.workspace_renamed'}, ${detail}::jsonb, NOW())`;
    return { changed: true };
  });
}

async function validateWorkspaceInput(name: string, confirmation: string) {
  const [nameMax, confirmationMax] = await Promise.all([runtimeConfig('root.workspaceNameMaxCharacters'), runtimeConfig('root.confirmationMaxCharacters')]);
  if (!name || name.length > nameMax) throw invalid('Enter a workspace name within the configured limit.');
  if (typeof confirmation !== 'string' || confirmation.length > confirmationMax) throw invalid('Enter the exact confirmation shown.');
}
