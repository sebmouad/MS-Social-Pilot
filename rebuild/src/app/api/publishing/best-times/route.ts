import { handle } from '@/modules/publishing/collaboration/http';
import { getBestTimeSuggestions } from '@/modules/publishing/server/best-time';
import { zonedTimeLabels } from '@/modules/publishing/server/display-time';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, {
  feature: 'publishing/posts', fallback: 'Suggested times are unavailable. / Les suggestions horaires sont indisponibles.',
  run: async actor => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'targetId')) throw new OperationError('invalid_request', 'Choose destinations. / Choisissez des destinations.');
    const result = await getBestTimeSuggestions(actor, { targetIds: query.getAll('targetId') });
    // Slot labels are formatted on the server so every browser shows the same workspace-zone time.
    const labels = await zonedTimeLabels(result.timeZone);
    return { ...result, suggestions: result.suggestions.map(slot => ({ ...slot, label: labels.slot(slot.nextAt) })) };
  },
});
