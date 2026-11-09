import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/server/data';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { readGithubPush, validGithubSignature } from './github';

export type UpdateRow = { id: string; commit: string | null; branch: string; source: 'github' | 'root'; status: 'requested' | 'running' | 'succeeded' | 'failed' | 'superseded';
  summary: string | null; deployedCommit: string | null; log: string | null; createdAt: Date; startedAt: Date | null; finishedAt: Date | null };

async function record(input: { commit: string | null; branch: string; source: 'github' | 'root'; requestedBy: string | null; summary: string | null }) {
  // One waiting request per commit: GitHub retries a delivery, and a second click on Update now adds nothing.
  const waiting = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM app_updates WHERE status = 'requested' AND branch = ${input.branch} AND "commit" IS NOT DISTINCT FROM ${input.commit} LIMIT 1`;
  if (waiting[0]) return waiting[0].id;
  const id = randomUUID();
  await prisma.$executeRaw`INSERT INTO app_updates (id, "commit", branch, source, status, "requestedBy", summary) VALUES (${id}, ${input.commit}, ${input.branch}, ${input.source}, 'requested', ${input.requestedBy}, ${input.summary})`;
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${input.requestedBy}, 'app.update_requested', ${JSON.stringify({ id, source: input.source, commit: input.commit, branch: input.branch })}::jsonb, NOW())`;
  return id;
}

/** A GitHub webhook delivery: checked, then recorded when it is a push to the deployed branch of the deployed repository. */
export async function receiveGithubDelivery(request: Request): Promise<Response> {
  const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  const raw = await request.text();
  if (raw.length > 5_000_000) return reply(413, { error: 'too_large' });
  const secret = await runtimeSecret('updates.githubWebhookSecret');
  if (!secret || !validGithubSignature(secret, raw, request.headers.get('x-hub-signature-256'))) return reply(401, { error: 'invalid_signature' });
  const event = request.headers.get('x-github-event');
  if (event === 'ping') return reply(200, { ok: true, event: 'ping' });
  if (event !== 'push') return reply(202, { ok: true, ignored: 'event' });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return reply(400, { error: 'invalid_json' }); }
  const push = readGithubPush(payload);
  const [automatic, repository, branch] = await Promise.all([runtimeConfig('updates.automatic') as Promise<boolean>, runtimeConfig('updates.repository') as Promise<string>, runtimeConfig('updates.branch') as Promise<string>]);
  if (!push || push.repository.toLowerCase() !== repository.toLowerCase() || push.branch !== branch) return reply(202, { ok: true, ignored: 'branch' });
  if (!automatic) return reply(202, { ok: true, ignored: 'automatic_updates_off' });
  const id = await record({ commit: push.commit, branch, source: 'github', requestedBy: null, summary: push.summary });
  return reply(202, { ok: true, update: id });
}

/** Root › Updates › Update now: the deployed branch's head at run time. */
export async function requestUpdateNow(actorId: string) {
  const branch = await runtimeConfig('updates.branch') as string;
  return { id: await record({ commit: null, branch, source: 'root', requestedBy: actorId, summary: null }) };
}

export async function readUpdates(limit = 20): Promise<UpdateRow[]> {
  return prisma.$queryRaw<UpdateRow[]>`SELECT id, "commit", branch, source, status, summary, "deployedCommit", log, "createdAt", "startedAt", "finishedAt" FROM app_updates ORDER BY "createdAt" DESC LIMIT ${limit}`;
}

/** The deploy script writes the release's commit beside the app ("abc1234 - message (date)"); absent before the first update. */
export async function runningVersion(): Promise<string | null> {
  try { return (await readFile(path.join(process.cwd(), '.current-commit'), 'utf8')).trim().slice(0, 300) || null; } catch { return null; }
}
