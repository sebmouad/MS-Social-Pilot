import { OperationError } from '@/lib/operation-error';
import { importPostsCsv } from '@/modules/publishing/server/lifecycle';
import { publishingWrite, requireBodyConfirmation } from '@/modules/publishing/server/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Import posts from CSV text (header message,firstComment,channels[,destinationFormats,firstCommentDelayMinutes]). body: { csv, confirmation: "IMPORT POSTS" }. */
export async function POST(request: Request) {
  return publishingWrite(request, async ({ actor, body }) => {
    requireBodyConfirmation(body, 'IMPORT POSTS');
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw new OperationError('invalid_request', 'csv is required.');
    return importPostsCsv(actor, body.csv);
  }, { status: 201, failure: 'The import outcome could not be confirmed. Refresh Posts before importing again.' });
}
