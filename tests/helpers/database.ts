import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * Test database setup.
 *
 * Each suite gets its own Postgres *schema* inside a shared test database, so
 * suites cannot see each other's rows and can run without coordination.
 * Schemas are cheap to create and drop, which keeps this fast enough to run on
 * every change.
 *
 * Requires a reachable Postgres. Point TEST_DATABASE_URL at it; the default
 * matches the Docker Compose development database.
 */

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/social_pilot_test';

export interface TestDatabase {
  url: string;
  schema: string;
  drop: () => void;
}

/**
 * Create an isolated schema and push the Prisma schema into it.
 *
 * `prisma db push` rather than `migrate deploy`: tests care about the current
 * schema, not the migration history, and pushing is markedly faster.
 */
export function setupTestDatabase(label: string): TestDatabase {
  const base = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
  const schema = `test_${label}_${randomBytes(4).toString('hex')}`;

  const url = new URL(base);
  url.searchParams.set('schema', schema);
  const databaseUrl = url.toString();

  process.env.DATABASE_URL = databaseUrl;

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  return {
    url: databaseUrl,
    schema,
    drop: () => {
      try {
        execFileSync(
          'psql',
          [base, '-c', `DROP SCHEMA IF EXISTS "${schema}" CASCADE`],
          { env: { ...process.env, PGPASSWORD: url.password }, stdio: 'pipe' },
        );
      } catch {
        // A leftover test schema is untidy, not a failure. Never fail a suite
        // in teardown over it.
      }
    },
  };
}

/**
 * Environment every suite needs before importing anything that reads config.
 * Set these *before* the first `import('../src/lib/...')`.
 */
export function setTestEnv(overrides: Record<string, string> = {}): void {
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SESSION_SECRET ??= 'integration-test-secret-at-least-32-characters';
  process.env.FACEBOOK_APP_ID ??= '111';
  process.env.FACEBOOK_APP_SECRET ??= 'integration-app-secret';
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}
