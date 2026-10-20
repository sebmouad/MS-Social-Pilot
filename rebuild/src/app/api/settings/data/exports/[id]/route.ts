import { NextResponse } from 'next/server';
import { operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { downloadWorkspaceExport } from '@/modules/settings/server/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'settings/data' }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    const { id } = await context.params;
    const archive = await downloadWorkspaceExport({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, id);
    const safeId = archive.id.replace(/[^A-Za-z0-9_-]/g, '-');
    return new Response(new Uint8Array(archive.content), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="workspace-export-${safeId}.zip"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    const result = operationFailure(error, 'The archive could not be downloaded. Refresh its status before trying again.');
    return reply({ error: result.error, code: result.code }, result.status);
  }
}
