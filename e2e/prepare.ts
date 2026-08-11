/**
 * Give the browser walk a database of its own.
 *
 * The walk registers the first account, so it has to start from a server
 * nobody has used yet — every run, not just the first. This drops and recreates
 * one schema rather than the whole database, so it cannot disturb a developer's
 * own data sitting in the same Postgres.
 */
import { execFileSync } from 'node:child_process';

const base = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/social_pilot_test';
const schema = 'e2e';

const url = new URL(base);
url.searchParams.set('schema', schema);

execFileSync('psql', [base, '-c', `DROP SCHEMA IF EXISTS "${schema}" CASCADE`], {
  env: { ...process.env, PGPASSWORD: url.password },
  stdio: 'inherit',
});

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  env: { ...process.env, DATABASE_URL: url.toString() },
  stdio: 'inherit',
});

process.stdout.write(`e2e database ready: schema "${schema}"\n`);
