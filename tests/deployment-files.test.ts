import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Docker files, read as text.
 *
 * Each assertion is a mistake that had shipped: a database published to every
 * interface with a well-known password, and a build context that copied `.env`
 * into an image layer. Neither shows up in any test that runs the app, and both
 * come back the moment somebody "simplifies" one of these files.
 */

const compose = readFileSync('docker-compose.yml', 'utf8');
const dockerignore = readFileSync('.dockerignore', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const dockerfile = readFileSync('Dockerfile', 'utf8');

describe('docker-compose.yml', () => {
  it('has no default database password', () => {
    expect(compose).not.toMatch(/POSTGRES_PASSWORD:-/);
    // Required in the Postgres service and in both connection strings.
    expect(compose.match(/\$\{POSTGRES_PASSWORD:\?/g)?.length).toBe(3);
  });

  it('publishes Postgres on loopback only, if at all', () => {
    const mappings = [...compose.matchAll(/^\s*-\s*'([^']*:5432)'/gm)].map((match) => match[1]!);
    for (const mapping of mappings) {
      expect(mapping).toMatch(/^127\.0\.0\.1:/);
    }
  });
});

describe('.dockerignore', () => {
  it.each(['.env', '.env.*', 'node_modules', '.next', 'media', '.git', 'e2e', 'test-results'])(
    'keeps %s out of the build context',
    (entry) => {
      expect(dockerignore).toContain(entry);
    },
  );

  it('does not exclude anything the build copies', () => {
    for (const needed of ['src', 'prisma', 'messages', 'scripts', 'public', 'package.json']) {
      expect(dockerignore).not.toContain(needed);
    }
  });
});

describe('Dockerfile', () => {
  it('ships a healthcheck that needs no curl', () => {
    expect(dockerfile).toMatch(/^HEALTHCHECK[\s\S]*node[\s\S]*\/api\/health/m);
  });
});
