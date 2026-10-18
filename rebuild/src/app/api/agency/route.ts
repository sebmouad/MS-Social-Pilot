import { NextResponse } from 'next/server';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { agencyOverview, listAgencyClients } from '@/modules/agency/server/agency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const KEYS = ['view', 'q', 'sort', 'order', 'attention'];
const invalid = () => new OperationError('invalid_request', 'Choose valid agency filters.');

/** Person-wide read for a browser session only. Credentials presented as API keys or bearer tokens are refused. */
export async function GET(request: Request) {
  try {
    if (request.headers.get('authorization') || request.headers.get('x-api-key')) throw new OperationError('forbidden', 'Agency data is available only to a signed-in person, not to API keys.');
    // Person-wide: the selected workspace's role must not decide access; the service checks every membership.
    const viewer = await requireViewer({ channelScoped: true }).catch(error => {
      // requireViewer signals "not signed in / no access" with a framework redirect; an API answers 401/403, never 502.
      const digest = typeof (error as { digest?: unknown } | null)?.digest === 'string' ? (error as { digest: string }).digest : '';
      if (!digest.startsWith('NEXT_REDIRECT')) throw error;
      throw digest.includes('/sign-in') ? new OperationError('unauthorized', 'Sign in to view agency data.') : new OperationError('forbidden', 'Agency data is not available for this account.');
    });
    const actor = { userId: viewer.user.id };
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !KEYS.includes(key) || query.getAll(key).length > 1)) throw invalid();
    const view = query.get('view') ?? 'overview';
    if (view === 'clients') {
      if ([...query.keys()].some(key => key !== 'view' && key !== 'q')) throw invalid();
      return reply(await listAgencyClients(actor, query.get('q') ? { q: query.get('q') } : {}));
    }
    if (view !== 'overview') throw invalid();
    const attention = query.get('attention');
    if (attention !== null && attention !== 'true' && attention !== 'false') throw invalid();
    return reply(await agencyOverview(actor, {
      ...(query.get('q') ? { q: query.get('q') } : {}), ...(query.get('sort') ? { sort: query.get('sort') } : {}),
      ...(query.get('order') ? { order: query.get('order') } : {}), ...(attention !== null ? { attentionOnly: attention === 'true' } : {}),
    }));
  } catch (error) { const failure = operationFailure(error, 'Agency data could not be loaded. Please try again.'); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
