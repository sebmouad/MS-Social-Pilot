import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { jobStopRequested } from '@/server/jobs/job-context';
import { captionTestPolicy } from './service';
import { evaluateTest, type CaptionOutcome, type EvaluationRow } from './plan';

type Running = { id: string; workspaceId: string; hours: number; minViews: number };
export type CaptionTestSummary = { examined: number; decided: number; inconclusive: number; waiting: number };

/**
 * Read every running test that is due. Database only: figures come from the platform sync, so this
 * never calls a provider. Suspended workspaces are skipped. A verdict is claimed by status
 * (`running` to final) with its audit entry in one transaction, so two workers record one verdict.
 */
export async function evaluateCaptionTests(now: Date = new Date()): Promise<CaptionTestSummary> {
  const summary: CaptionTestSummary = { examined: 0, decided: 0, inconclusive: 0, waiting: 0 };
  const policy = await captionTestPolicy();
  const tests = await prisma.$queryRaw<Running[]>`SELECT t.id, t."workspaceId", t.hours, t."minViews" FROM caption_tests t JOIN workspaces w ON w.id = t."workspaceId" WHERE t.status = 'running' AND w."suspendedAt" IS NULL ORDER BY t."createdAt" ASC, t.id ASC LIMIT ${policy.evaluateBatch}`;
  for (const test of tests) {
    if (jobStopRequested()) break;
    summary.examined += 1;
    const rows = await prisma.$queryRaw<EvaluationRow[]>`SELECT p."captionLabel", p.status::text AS "postStatus", pt.status::text AS "targetStatus", pt."publishedAt", pt.insights, pt."insightsSyncedAt" FROM posts p LEFT JOIN post_targets pt ON pt."postId" = p.id WHERE p."captionTestId" = ${test.id} AND p."workspaceId" = ${test.workspaceId}`;
    const outcome: CaptionOutcome | null = evaluateTest(test, rows, now, policy);
    if (!outcome) { summary.waiting += 1; continue; }
    const claimed = await prisma.$transaction(async tx => {
      const count = await tx.$executeRaw`UPDATE caption_tests SET status = ${outcome.status}, reason = ${outcome.reason}, "winnerLabel" = ${outcome.winnerLabel ?? null}, lift = ${outcome.lift ?? null}, results = ${outcome.results ? JSON.stringify(outcome.results) : null}::jsonb, "decidedAt" = ${now} WHERE id = ${test.id} AND "workspaceId" = ${test.workspaceId} AND status = 'running'`;
      if (count !== 1) return false;
      await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${test.workspaceId}, NULL, 'publishing.caption_test_finished', ${JSON.stringify({ id: test.id, status: outcome.status, reason: outcome.reason, winnerLabel: outcome.winnerLabel ?? null })}::jsonb, ${now})`;
      return true;
    });
    if (claimed) summary[outcome.status === 'decided' ? 'decided' : 'inconclusive'] += 1;
  }
  return summary;
}

/** Worker entry: one summary line for the shared run history. */
export async function runCaptionTestBatch(now: Date = new Date()): Promise<string> {
  const s = await evaluateCaptionTests(now);
  return `examined=${s.examined} decided=${s.decided} inconclusive=${s.inconclusive} waiting=${s.waiting}`;
}
