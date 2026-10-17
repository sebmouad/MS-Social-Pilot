import { readRootBackupStatus, readRootDiagnosticsSummary } from '@/server/root/legacy/backups';
import { rootRoute, searchParamsObject } from '@/server/root/legacy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read only. There is deliberately no write method: Root cannot start or restore backups. */
export const GET = rootRoute({}, async (request, actorId) => {
  searchParamsObject(request);
  const [backups, diagnostics] = await Promise.all([readRootBackupStatus(actorId), readRootDiagnosticsSummary(actorId)]);
  return { backups, diagnostics };
});
