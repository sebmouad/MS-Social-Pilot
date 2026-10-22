import { historyGet } from '@/modules/history/server/http';
import { listWorkspaceEmails } from '@/modules/history/server/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Emails sent for the workspace, newest first, with recent delivery problems. Owners and admins only. */
export const GET = (request: Request) => historyGet(request, ['q', 'offset', 'limit', 'problemsOnly'], (actor, filters) => listWorkspaceEmails(actor, filters));
