import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { labelInstants, requestLocale, workspaceInstantFormatter } from '@/server/instant-labels';
import { listWorkspaceExports, requestWorkspaceExport } from '@/modules/settings/server/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const inputSchema = z.object({ confirmation: z.string().max(400) }).strict();
function failure(error: unknown) {
  const result = operationFailure(error instanceof z.ZodError || error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid export request.') : error, 'The export operation could not be confirmed. Refresh the export list before trying again.');
  return reply({ error: result.error, code: result.code }, result.status);
}
export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/data' }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try { const instants = await workspaceInstantFormatter(viewer.workspaceId, requestLocale(request)); return reply({ jobs: (await listWorkspaceExports({ userId: viewer.user.id, workspaceId: viewer.workspaceId })).map(job => labelInstants(job, { createdAt: 'dateTime', expiresAt: 'dateTime' }, instants)) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).origin !== requestOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  catch { return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/data', write: true }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    const input = inputSchema.parse(await request.json());
    const job = await requestWorkspaceExport({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input.confirmation);
    return reply({ job: labelInstants(job, { createdAt: 'dateTime', expiresAt: 'dateTime' }, await workspaceInstantFormatter(viewer.workspaceId, requestLocale(request))) }, 202);
  } catch (error) { return failure(error); }
}
