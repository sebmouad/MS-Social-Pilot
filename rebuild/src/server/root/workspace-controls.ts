import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';

type CreateInput = { name: string; ownerEmail: string; timezone: string; confirmation: string };

function validTimezone(timezone: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); return true; } catch { return false; }
}

export async function createRootWorkspace(actorId: string, input: CreateInput) {
  const name = input.name.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!name) throw new Error('Enter a workspace name.');
  if (!validTimezone(input.timezone)) throw new Error('Choose a valid timezone.');
  if (input.confirmation !== `CREATE ${name} FOR ${ownerEmail}`) throw new Error('Enter the exact confirmation shown.');
  const id = randomUUID();
  const base = name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
  const slug = `${base}-${id}`;
  return prisma.$transaction(async tx => {
    const owner = await tx.user.findUnique({ where: { email: ownerEmail }, select: { id: true, email: true, disabledAt: true } });
    if (!owner || owner.disabledAt) throw new Error('Choose an existing active account as owner.');
    const workspace = await tx.workspace.create({ data: { id, name, slug, timezone: input.timezone, memberships: { create: { id: randomUUID(), userId: owner.id, role: 'owner' } } }, select: { id: true, slug: true } });
    const detail = JSON.stringify({ workspaceId: workspace.id, ownerId: owner.id });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${'root.workspace_created'}, ${detail}::jsonb, NOW())`;
    return workspace;
  });
}

export async function renameRootWorkspace(actorId: string, workspaceId: string, nameInput: string, confirmation: string) {
  const name = nameInput.trim();
  if (!name) throw new Error('Enter a workspace name.');
  return prisma.$transaction(async tx => {
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true, dataPurge: { select: { status: true } } } });
    if (!workspace) throw new Error('Workspace not found.');
    if (workspace.dataPurge) throw new Error('Workspace deletion is in progress.');
    if (confirmation !== `RENAME ${workspace.name} TO ${name}`) throw new Error('Enter the exact confirmation shown.');
    if (name === workspace.name) return { changed: false };
    const result = await tx.workspace.updateMany({ where: { id: workspaceId, name: workspace.name }, data: { name } });
    if (result.count !== 1) throw new Error('Workspace changed; reload and try again.');
    const detail = JSON.stringify({ workspaceId, previousName: workspace.name, name });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${'root.workspace_renamed'}, ${detail}::jsonb, NOW())`;
    return { changed: true };
  });
}
