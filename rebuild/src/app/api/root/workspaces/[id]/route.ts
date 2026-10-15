import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentRootActor } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { renameRootWorkspace } from '@/server/root/workspace-controls';

export const runtime = 'nodejs';
const schema = z.object({ name: z.string().trim().min(1), confirmation: z.string().min(1) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 }); }
  catch { return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 }); }
  const actor = await currentRootActor();
  if (!actor?.isInstanceOwner) return NextResponse.json({ error: 'Not found.' }, { status: actor ? 404 : 401 });
  try {
    const { id } = await params;
    if (!id || id.length > 200) return NextResponse.json({ error: 'Invalid workspace.' }, { status: 400 });
    const input = schema.parse(await request.json());
    const maxName = await runtimeConfig('root.workspaceNameMaxCharacters');
    if (input.name.length > maxName) return NextResponse.json({ error: `Workspace name must be ${maxName} characters or fewer.` }, { status: 400 });
    const result = await renameRootWorkspace(actor.id, id, input.name, input.confirmation);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid workspace change.' }, { status: 400 });
    if (error instanceof Error && /^(Workspace not found|Workspace deletion|Enter a workspace|Enter the exact|Workspace changed)/.test(error.message)) return NextResponse.json({ error: error.message }, { status: error.message === 'Workspace not found.' ? 404 : 409 });
    return NextResponse.json({ error: 'Workspace could not be renamed.' }, { status: 500 });
  }
}
