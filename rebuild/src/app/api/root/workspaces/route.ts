import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentRootActor } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { createRootWorkspace } from '@/server/root/workspace-controls';
import { listRootWorkspaces } from '@/server/root/directory';
import { rootRoute, searchParamsObject } from '@/server/root/legacy/http';
import { OperationError } from '@/lib/operation-error';

export const runtime = 'nodejs';
const schema = z.object({ name: z.string().trim().min(1), ownerEmail: z.string().trim().email(), confirmation: z.string().min(1), timezone: z.string().optional() }).strict();

/** Private directory read through the same service and Root page size as MCP/UI. */
export const GET = rootRoute({}, async request => {
  const query = searchParamsObject(request, ['q', 'page']);
  if (query.page !== undefined && (!Number.isSafeInteger(Number(query.page)) || Number(query.page) < 1)) throw new OperationError('invalid_request', 'Choose a valid workspace query and page.');
  return listRootWorkspaces(query, Number(await runtimeConfig('root.directoryPageSize')));
});

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).origin !== requestOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 }); }
  catch { return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 }); }
  const actor = await currentRootActor();
  if (!actor?.isInstanceOwner) return NextResponse.json({ error: 'Not found.' }, { status: actor ? 404 : 401 });
  try {
    const input = schema.parse(await request.json());
    const maxName = await runtimeConfig('root.workspaceNameMaxCharacters');
    if (input.name.length > maxName) return NextResponse.json({ error: `Workspace name must be ${maxName} characters or fewer.` }, { status: 400 });
    const timezone = input.timezone ?? await runtimeConfig('root.defaultWorkspaceTimezone');
    const result = await createRootWorkspace(actor.id, { ...input, timezone });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid workspace.' }, { status: 400 });
    if (error instanceof Error && /^(Enter a workspace|Choose a valid|Enter the exact|Choose an existing)/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: 'Workspace could not be created.' }, { status: 500 });
  }
}
