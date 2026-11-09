// The GitHub push webhook: only a delivery signed with the saved secret counts, and only a push of a branch head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readGithubPush, validGithubSignature } from '@/modules/root/server/updates/github';

const secret = 'a-long-random-secret';
const body = JSON.stringify({ ref: 'refs/heads/main', after: 'a'.repeat(40), repository: { full_name: 'sebmouad/MS-Social-Pilot' }, head_commit: { message: 'Fix the inbox\n\nlong body' } });
const sign = (key: string, raw: string) => `sha256=${createHmac('sha256', key).update(raw).digest('hex')}`;

test('accepts the signature GitHub computes with the saved secret', () => {
  assert.equal(validGithubSignature(secret, body, sign(secret, body)), true);
});

test('refuses a wrong secret, a changed body, a missing or malformed header, and an empty secret', () => {
  assert.equal(validGithubSignature(secret, body, sign('other', body)), false);
  assert.equal(validGithubSignature(secret, body + ' ', sign(secret, body)), false);
  assert.equal(validGithubSignature(secret, body, null), false);
  assert.equal(validGithubSignature(secret, body, 'sha1=' + 'a'.repeat(40)), false);
  assert.equal(validGithubSignature(secret, body, sign(secret, body).toUpperCase()), false);
  assert.equal(validGithubSignature('', body, sign('', body)), false);
});

test('reads the branch, commit and first line of the message of a push', () => {
  assert.deepEqual(readGithubPush(JSON.parse(body)), { repository: 'sebmouad/MS-Social-Pilot', branch: 'main', commit: 'a'.repeat(40), summary: 'Fix the inbox' });
});

test('ignores tags, deleted branches and malformed commits', () => {
  const base = JSON.parse(body);
  assert.equal(readGithubPush({ ...base, ref: 'refs/tags/v1' }), null);
  assert.equal(readGithubPush({ ...base, deleted: true }), null);
  assert.equal(readGithubPush({ ...base, after: '0'.repeat(40) }), null);
  assert.equal(readGithubPush({ ...base, after: 'main; rm -rf /' }), null);
  assert.equal(readGithubPush({ ...base, repository: undefined }), null);
  assert.equal(readGithubPush('not an object'), null);
});
