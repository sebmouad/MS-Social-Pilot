import { createHmac, timingSafeEqual } from 'node:crypto';

/** GitHub signs every webhook delivery: X-Hub-Signature-256 = "sha256=" + hex HMAC-SHA256 of the raw body keyed with the secret. */
export function validGithubSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type GithubPush = { repository: string; branch: string; commit: string; summary: string | null };

/** The parts of a push delivery the updater needs, or null when it is not a push of one branch's new head. */
export function readGithubPush(payload: unknown): GithubPush | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as { ref?: unknown; after?: unknown; deleted?: unknown; repository?: { full_name?: unknown }; head_commit?: { message?: unknown } | null };
  if (typeof body.ref !== 'string' || !body.ref.startsWith('refs/heads/') || body.deleted === true) return null;
  if (typeof body.after !== 'string' || !/^[0-9a-f]{40}$/.test(body.after) || /^0+$/.test(body.after)) return null;
  if (typeof body.repository?.full_name !== 'string') return null;
  const message = typeof body.head_commit?.message === 'string' ? body.head_commit.message.split('\n')[0]!.slice(0, 200) : null;
  return { repository: body.repository.full_name, branch: body.ref.slice('refs/heads/'.length), commit: body.after, summary: message };
}
