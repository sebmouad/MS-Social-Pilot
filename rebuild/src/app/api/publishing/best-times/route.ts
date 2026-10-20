import { handle } from '@/modules/publishing/collaboration/http';
import { getBestTimeSuggestions } from '@/modules/publishing/server/best-time';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, {
  feature: 'publishing/posts', fallback: 'Suggested times are unavailable. / Les suggestions horaires sont indisponibles.',
  run: actor => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'targetId')) throw new OperationError('invalid_request', 'Choose destinations. / Choisissez des destinations.');
    return getBestTimeSuggestions(actor, { targetIds: query.getAll('targetId') });
  },
});
