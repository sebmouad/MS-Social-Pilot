import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  ['postgresql://example:example@remote.invalid/social_pilot_preview', 'http://localhost:3200', 'Database must be isolated'],
  ['postgresql://example:example@localhost/social_pilot', 'http://localhost:3200', 'Database must be isolated'],
  ['postgresql://example:example@localhost/social_pilot_preview?hostaddr=192.0.2.1', 'http://localhost:3200', 'Database must be isolated'],
  ['postgresql://example:example@localhost/social_pilot_preview', 'https://example.invalid', 'Origin must be an explicit localhost'],
])('refuses unsafe local-probe targets before opening a database (%s)', (database, origin, message) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-installation-mcp.ts'], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, REBUILD_PREVIEW_DATABASE_URL: database, REBUILD_PREVIEW_ORIGIN: origin } });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
  expect(result.stdout).not.toContain('cleanup verified');
});
