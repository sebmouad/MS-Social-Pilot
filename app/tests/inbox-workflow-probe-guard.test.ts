import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  ['postgresql://example:DO_NOT_PRINT@remote.invalid/social_pilot_preview', 'http://localhost:3200', 'test', 'Database must be isolated'],
  ['postgresql://example:DO_NOT_PRINT@localhost/social_pilot', 'http://localhost:3200', 'test', 'Database must be isolated'],
  ['postgresql://example:DO_NOT_PRINT@localhost/social_pilot_preview?hostaddr=192.0.2.1', 'http://localhost:3200', 'test', 'Database must be isolated'],
  ['postgresql://example:DO_NOT_PRINT@localhost/social_pilot_preview?host=remote.invalid', 'http://localhost:3200', 'test', 'Database must be isolated'],
  ['postgresql://example:DO_NOT_PRINT@localhost/social_pilot_preview', 'https://example.invalid', 'test', 'Origin must be explicit localhost'],
  ['postgresql://example:DO_NOT_PRINT@localhost/social_pilot_preview', 'http://localhost:3200', 'production', 'refused in production'],
] as const)('refuses unsafe workflow-probe targets before opening the database (%s)', (database, origin, mode, message) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-inbox-workflow.ts'], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATABASE_URL: database, REBUILD_PREVIEW_ORIGIN: origin, NODE_ENV: mode, ENCRYPTION_KEY: '' } });
  expect(result.status).toBe(1); expect(result.stderr).toContain(message);
  expect(result.stdout + result.stderr).not.toContain('DO_NOT_PRINT'); expect(result.stdout).not.toContain('cleanupVerified');
});
