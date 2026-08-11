import { requireAuth } from '@/lib/auth';
import { assertBulkRowsAllowed, createPost } from '@/lib/posts';
import { parseCsvWithHeader } from '@/lib/csv';
import { bulkUploadSchema, bulkRowSchema } from '@/lib/validation';
import { asGraphError } from '@/lib/facebook/graph';
import { ok, readJson, route } from '@/lib/api';

/**
 * Bulk-schedule posts from a CSV.
 *
 * Rows are processed independently and the response reports every row's
 * outcome. Aborting the whole upload on the first bad row would be worse: a
 * 200-row campaign should not be lost to one malformed date.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = bulkUploadSchema.parse(await readJson(request));

  const rows = parseCsvWithHeader(input.csv);

  assertBulkRowsAllowed(rows.length);

  const results: Array<{ row: number; status: 'scheduled' | 'error'; postId?: string; message?: string }> = [];

  let rowNumber = 1; // 1 is the header; data starts at 2.
  for (const raw of rows) {
    rowNumber += 1;

    const parsed = bulkRowSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ row: rowNumber, status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid row.' });
      continue;
    }

    const row = parsed.data;
    if (!row.message && !row.link && !row.media_url) {
      results.push({ row: rowNumber, status: 'error', message: 'Row has no message, link or media.' });
      continue;
    }

    try {
      const created = await createPost(
            {
          workspaceId: auth.workspace.id,
          userId: auth.user.id,
          role: auth.role,
          requiresApproval: auth.workspace.requiresApproval,
        },
        {
          message: row.message,
          link: row.link ? row.link : null,
          media: row.media_url
            ? [
                {
                  id: `csv-${rowNumber}`,
                  // CSV can only reference externally hosted images.
                  kind: 'image' as const,
                  url: row.media_url,
                },
              ]
            : [],
          targetIds: input.targetIds,
          publishMode: input.publishMode,
          // A blank scheduled_at means "put it in the next free queue slot".
          scheduledAtLocal: row.scheduled_at ? normaliseDate(row.scheduled_at) : null,
          timezone: input.timezone,
          useQueue: !row.scheduled_at,
          saveAsDraft: false,
        },
      );
      results.push({ row: rowNumber, status: 'scheduled', postId: created.postId });
    } catch (error) {
      results.push({ row: rowNumber, status: 'error', message: asGraphError(error).displayMessage });
    }
  }

  return ok({
    total: results.length,
    scheduled: results.filter((result) => result.status === 'scheduled').length,
    failed: results.filter((result) => result.status === 'error').length,
    results,
  });
});

/**
 * Accept the spreadsheet-friendly `YYYY-MM-DD HH:MM` alongside the ISO
 * `YYYY-MM-DDTHH:MM` that the composer sends.
 */
function normaliseDate(value: string): string {
  const trimmed = value.trim().replace(' ', 'T');
  return trimmed.length === 16 ? trimmed : trimmed.slice(0, 16);
}
