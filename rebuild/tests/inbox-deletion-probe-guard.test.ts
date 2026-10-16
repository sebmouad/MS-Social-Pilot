import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const marker = 'NEVER_PRINT_INBOX_DELETION_PROBE';

it.each([
  [`postgresql://probe:${marker}@remote.invalid/social_pilot_preview`, 'http://localhost:3200', 'test', '', 'Database must be isolated'],
  [`postgresql://probe:${marker}@localhost/social_pilot`, 'http://localhost:3200', 'test', '', 'Database must be isolated'],
  [`postgresql://probe:${marker}@localhost/social_pilot_preview?hostaddr=192.0.2.1`, 'http://localhost:3200', 'test', '', 'Database must be isolated'],
  [`postgresql://probe:${marker}@localhost/social_pilot_preview?host=remote.invalid`, 'http://localhost:3200', 'test', '', 'Database must be isolated'],
  [`postgresql://probe:${marker}@localhost/social_pilot_preview`, 'https://example.invalid', 'test', '', 'Origin must be explicit localhost'],
  [`postgresql://probe:${marker}@localhost/social_pilot_preview`, 'http://127.0.0.1:3200', 'test', '', 'Origin must be explicit localhost'],
  [`postgresql://probe:${marker}@localhost/social_pilot_preview`, 'http://localhost:3200', 'production', '', 'refused in production'],
  [`postgresql://probe:${marker}@localhost/social_pilot_preview`, 'http://localhost:3200', 'test', '', 'encryption key is required'],
] as const)('refuses unsafe Inbox deletion probe targets before connecting (%s)', (database, origin, mode, key, message) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-inbox-deletion.ts'], {
    cwd: process.cwd(), encoding: 'utf8', env: {
      ...process.env, DATABASE_URL: database, REBUILD_PREVIEW_DATABASE_URL: database,
      REBUILD_PREVIEW_ORIGIN: origin, NODE_ENV: mode, ENCRYPTION_KEY: key,
    },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
  expect(result.stdout + result.stderr).not.toContain(marker);
  expect(result.stdout).not.toContain('cleanupVerified');
});
