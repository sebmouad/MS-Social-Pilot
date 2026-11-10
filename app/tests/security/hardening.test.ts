// Protections added after the November 2026 audit. Each test fails if its protection is removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nextConfig from '../../next.config';
import { openWordpressDb } from '@/modules/feeds/wordpress/db';
import { parseMetaWebhookPayload } from '@/platforms/facebook/webhooks';

test('every response carries the framing, transport and referrer protections', async () => {
  const rules = await nextConfig.headers!();
  const all = rules.find(rule => rule.source === '/:path*');
  assert.ok(all, 'a rule covers every path');
  const sent = Object.fromEntries(all.headers.map(header => [header.key.toLowerCase(), header.value]));
  assert.equal(sent['x-frame-options'], 'SAMEORIGIN');
  assert.match(sent['content-security-policy'] ?? '', /frame-ancestors 'self'/);
  assert.match(sent['strict-transport-security'] ?? '', /max-age=\d{8}/);
  assert.equal(sent['x-content-type-options'], 'nosniff');
  assert.ok(sent['referrer-policy']);
});

test('the middleware closes the image optimizer endpoint', () => {
  assert.match(readFileSync(join(__dirname, '../../src/middleware.ts'), 'utf8'), /pathname === '\/_next\/image'\) return new NextResponse\(null, \{ status: 404/);
});

for (const siteUrl of ['http://127.0.0.1', 'http://localhost', 'https://10.0.0.5', 'https://169.254.169.254', 'https://[::1]', 'https://example.com:8443']) {
  test(`the WordPress connector refuses to call ${siteUrl}`, async () => {
    const db = await openWordpressDb({ siteUrl, connectTimeoutMs: 2000, queryTimeoutMs: 2000 });
    await assert.rejects(db.ping(), (error: { reason?: string }) => error.reason === 'blocked_host' || error.reason === 'blocked_address');
  });
}

test('a Page webhook batch is still parsed, and only Page batches are', () => {
  assert.equal(parseMetaWebhookPayload({ object: 'page', entry: [] }).length, 0);
  assert.throws(() => parseMetaWebhookPayload({ object: 'instagram', entry: [] }));
});

test('the updater runs the deploy command installed on the server, never a script taken from the commit', () => {
  const updater = readFileSync(join(__dirname, '../../scripts/updater.sh'), 'utf8');
  assert.doesNotMatch(updater, /git .*show .*deploy-from-server\.sh/);
  assert.match(updater, /SOCIAL_PILOT_UPDATER=1 .*bash "\$script"/);
  const deploy = readFileSync(join(__dirname, '../../scripts/deploy-from-server.sh'), 'utf8');
  assert.match(deploy, /if \[ -z "\$\{SOCIAL_PILOT_UPDATER:-\}" \]; then\n  install -m 0755 "\$BUILD_DIR\/app\/scripts\/updater\.sh"/);
  assert.match(deploy, /if \[ -z "\$\{SOCIAL_PILOT_UPDATER:-\}" \] && \[ -z "\$\{SP_DEPLOY_HANDED_OVER:-\}" \]/);
});

test('the backup script stops with an error, and leaves no partial dump, when the database cannot be dumped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-backup-'));
  const fake = join(dir, 'fail.sh');
  writeFileSync(fake, '#!/usr/bin/env bash\nexit 1\n'); chmodSync(fake, 0o755);
  let code = 0;
  try { execFileSync('bash', [join(__dirname, '../../scripts/backup.sh'), '--database-only'], { env: { ...process.env, BACKUP_DIR: join(dir, 'out'), AS_POSTGRES: fake, DB_NAME: 'none' }, stdio: 'pipe' }); }
  catch (error) { code = (error as { status: number }).status; }
  assert.equal(code, 1);
  assert.equal(execFileSync('bash', ['-c', `ls ${join(dir, 'out', 'db')} | wc -l`]).toString().trim(), '0');
});
