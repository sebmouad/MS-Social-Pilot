import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { addTeamMember, removeTeamMember, teamErrorStatus, updateTeamMember } from '@/server/team';

export const runtime = 'nodejs';
const targetIds = z.array(z.string().min(1).max(200)).max(500).refine(ids => new Set(ids).size === ids.length, 'Channel assignments must be unique.');
const addSchema = z.object({ email: z.string().email().max(320), role: z.string(), targetIds, allPages: z.boolean() });
const updateSchema = z.object({ membershipId: z.string().min(1).max(200), role: z.string(), targetIds, allPages: z.boolean() });
const removeSchema = z.object({ membershipId: z.string().min(1).max(200) });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/team' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = addSchema.parse(await request.json());
    await addTeamMember({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.email, input.role, input.targetIds, input.allPages);
    return NextResponse.json({ ok: true });
  } catch (error) { return mutationError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/team' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = updateSchema.parse(await request.json());
    await updateTeamMember({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.membershipId, input.role, input.targetIds, input.allPages);
    return NextResponse.json({ ok: true });
  } catch (error) { return mutationError(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/team' }); }
  catch { return NextResponse.json({ error: 'Not authorized.' }, { status: 401 }); }
  try {
    const input = removeSchema.parse(await request.json());
    await removeTeamMember({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.membershipId);
    return NextResponse.json({ ok: true });
  } catch (error) { return mutationError(error); }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function mutationError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid team change.' }, { status: 400 });
  return NextResponse.json({ error: error instanceof Error && teamErrorStatus(error) !== 500 ? error.message : 'Team change failed.' }, { status: teamErrorStatus(error) });
}
