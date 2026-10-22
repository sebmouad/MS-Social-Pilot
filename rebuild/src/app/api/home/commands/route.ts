import { NextResponse } from 'next/server';
import { operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { listNavigationCommands } from '@/modules/home/server/commands';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

/** The signed-in member's openable pages for the command palette. The service repeats every check. */
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ module: 'home' });
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'q' || params.getAll(key).length !== 1)) return reply({ error: 'Choose a valid search.', code: 'invalid_request' }, 400);
    return reply(await listNavigationCommands({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, params.has('q') ? { q: params.get('q') } : {}));
  } catch (error) {
    const failure = operationFailure(error, 'The command palette is unavailable.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
