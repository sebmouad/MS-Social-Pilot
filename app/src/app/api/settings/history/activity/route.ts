import { historyGet } from '@/modules/history/server/http';
import { listWorkspaceActivity } from '@/modules/history/server/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Workspace activity, newest first. Owners and admins only; the service repeats every check. */
export const GET = (request: Request) => historyGet(request, ['q', 'offset', 'limit'], (actor, filters) => listWorkspaceActivity(actor, filters));
