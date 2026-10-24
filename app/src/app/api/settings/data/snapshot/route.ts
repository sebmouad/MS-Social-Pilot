import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { exportWorkspaceData } from '@/server/data-control';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const viewer = await requireViewer({ feature: 'settings/data' }).catch(() => { throw new OperationError('unauthorized', 'Sign in to an authorized workspace.'); });
    return Response.json(await exportWorkspaceData({ userId: viewer.user.id, workspaceId: viewer.workspaceId }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const safe = operationFailure(error, 'Workspace data could not be exported.');
    return Response.json({ error: safe.error, code: safe.code }, { status: safe.status, headers: { 'cache-control': 'no-store' } });
  }
}
