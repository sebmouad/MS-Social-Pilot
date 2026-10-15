import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentRootActor } from '@/server/config/access';
import { setRootUserDisabled } from '@/server/root/user-controls';

export const runtime = 'nodejs';
const schema = z.object({ disabled: z.boolean(), confirmation: z.string().min(1).max(400) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 }); }
  catch { return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 }); }
  const actor = await currentRootActor();
  if (!actor?.isInstanceOwner) return NextResponse.json({ error: 'Not found.' }, { status: actor ? 404 : 401 });
  try {
    const { id } = await params;
    if (!id || id.length > 200) return NextResponse.json({ error: 'Invalid user.' }, { status: 400 });
    const input = schema.parse(await request.json());
    const result = await setRootUserDisabled(actor.id, id, input.disabled, input.confirmation);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid account change.' }, { status: 400 });
    if (error instanceof Error && /^(User not found|You cannot change|Enter the exact|Cannot disable the last|Account state changed)/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'User not found.' ? 404 : 409 });
    }
    return NextResponse.json({ error: 'Account change failed.' }, { status: 500 });
  }
}
