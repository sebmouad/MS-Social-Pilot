import { OperationError } from '@/lib/operation-error';
import { ROOT_PRIVILEGE_CSV_FORMAT, ROOT_PRIVILEGE_CSV_NAME } from '@/server/root/legacy/shared';
import { exportRootPrivileges } from '@/server/root/legacy/privileges';
import { rootRoute, searchParamsObject } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Complete-or-refused confirmed CSV download. */
export const GET = rootRoute({}, async (request, actorId) => {
  const result = await exportRootPrivileges(actorId, searchParamsObject(request, ['q', 'role', 'workspaceId']));
  if (result.truncated) throw new OperationError('invalid_request', 'The complete export exceeds the current limit. Narrow the filters.');
  return new Response(result.csv, { headers: {
    'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${ROOT_PRIVILEGE_CSV_NAME}"`, 'cache-control': 'no-store, max-age=0',
    'x-msp-export-format': ROOT_PRIVILEGE_CSV_FORMAT, 'x-msp-export-bytes': String(result.bytes),
    'x-export-rows': String(result.rows), 'x-export-total': String(result.total), 'x-export-truncated': String(result.truncated),
  } });
});
