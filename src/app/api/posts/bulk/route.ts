import { requireAuth } from '@/lib/auth';
import { assertPagesAllowed } from '@/lib/page-access';
import { assertBulkRowsAllowed, createPost } from '@/lib/posts';
import { parseCsvWithHeader } from '@/lib/csv';
import { bulkUploadSchema, bulkRowSchema } from '@/lib/validation';
import { asGraphError } from '@/lib/facebook/graph';
import { ok, readJson, route } from '@/lib/api';
import { logActivity } from '@/lib/scheduler/runner';

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
  assertPagesAllowed(auth.pageScope, input.targetIds);

  const { rows, problems } = parseCsvWithHeader(input.csv);

  assertBulkRowsAllowed(rows.length);

  const results: Array<{ row: number; status: 'scheduled' | 'error'; postId?: string; message?: string }> = [];

  // A row with more values than the header has shifted, so whatever it would
  // have scheduled is not what the file says. Reported per row like any other
  // bad row, rather than dropped on the floor.
  const malformed = new Map(problems.map((problem) => [problem.line, problem.message]));

  let rowNumber = 1; // 1 is the header; data starts at 2.
  for (const raw of rows) {
    rowNumber += 1;

    const structural = malformed.get(rowNumber);
    if (structural) {
      results.push({ row: rowNumber, status: 'error', message: structural });
      continue;
    }

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

  const rejected = results.filter((result) => result.status === 'error');

  // The per-row outcome exists only in this response, and a five-hundred-row
  // file can outlast a request timeout — or the uploader can simply close the
  // tab. Either way a rejected row leaves no trace, so a campaign quietly
  // twenty posts short looks exactly like one that worked.
  //
  // The scheduled rows each log `post.created` already; this records the
  // upload as a whole, so the rejections are still findable afterwards.
  await logActivity(
    auth.workspace.id,
    'post.bulkUploaded',
    {
      total: results.length,
      scheduled: results.length - rejected.length,
      failed: rejected.length,
      // Bounded: a file where every row is wrong must not write a row's worth
      // of JSON per row into the audit trail.
      rejected: rejected.slice(0, 25).map((result) => ({ row: result.row, message: result.message })),
      rejectedShown: Math.min(rejected.length, 25),
    },
    auth.user.id,
  );

  return ok({
    total: results.length,
    scheduled: results.length - rejected.length,
    failed: rejected.length,
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
