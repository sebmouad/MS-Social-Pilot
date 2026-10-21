import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createRootWorkspace } from '@/server/root/workspace-controls';
import { listRootWorkspaces } from '@/server/root/directory';
import { rootRoute, searchParamsObject } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
const schema = z.object({ name: z.string().trim().min(1), ownerEmail: z.string().trim().email(), confirmation: z.string().min(1), timezone: z.string().optional() }).strict();

/** Private directory read through the same service and Root page size as MCP/UI. */
export const GET = rootRoute({}, async (request, actorId) => listRootWorkspaces(actorId, searchParamsObject(request, ['q', 'page'])));

export const POST = rootRoute({ write: true }, async (request, actorId) => {
  const result = await createRootWorkspace(actorId, schema.parse(await request.json()));
  return NextResponse.json({ ok: true, ...result }, { status: 201, headers: { 'cache-control': 'no-store' } });
});
