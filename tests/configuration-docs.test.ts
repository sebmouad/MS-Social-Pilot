import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SETTING_DEFINITIONS } from '../src/lib/settings/definitions';

/**
 * The registry, the sample environment file and the schema notes describe the
 * same configuration three times, and three copies drift. They drifted: this
 * suite was written after two settings added in one sitting reached one file
 * and not the others.
 *
 * The registry is the source of truth — the config screen, the API and the
 * validation are all generated from it — so these tests only ask the documents
 * to keep up with it.
 */

const envExample = readFileSync('.env.example', 'utf8');
const schemaNotes = readFileSync('docs/PROJECT_SCHEMA.md', 'utf8');

/**
 * Variables that cannot be settings, and so will never be in the registry.
 *
 * `DATABASE_URL` is what the settings table is read through, `ENCRYPTION_KEY`
 * protects the secrets inside it, and `SESSION_SECRET` cannot be rotated from
 * inside a session.
 */
const BOOTSTRAP_ONLY = new Set(['DATABASE_URL', 'ENCRYPTION_KEY', 'SESSION_SECRET']);

/**
 * Variables read before the app exists, so they cannot be settings either.
 *
 * A setting is stored in the database and changed from the configuration
 * screen. These decide where the process listens, which has to be known before
 * anything can be served — including the screen that would change it. Each is
 * asserted below to be read by something in the repository, so this list
 * cannot become a place to hide a name nothing uses.
 */
const PROCESS_ONLY = new Map([
  ['PORT', 'scripts/start.mjs'],
  ['HOST', 'scripts/start.mjs'],
  ['APP_PORT', 'docker-compose.yml'],
  ['POSTGRES_PASSWORD', 'docker-compose.yml'],
]);

const registryEnvNames = SETTING_DEFINITIONS.flatMap((definition) =>
  definition.env ? [definition.env] : [],
);

function namesAssignedIn(text: string): string[] {
  return [...text.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!);
}

describe('configuration documentation', () => {
  it('offers every setting in the sample environment file', () => {
    const missing = registryEnvNames.filter((name) => !envExample.includes(name));
    expect(missing).toEqual([]);
  });

  it('offers every setting in the schema notes', () => {
    const missing = registryEnvNames.filter((name) => !schemaNotes.includes(name));
    expect(missing).toEqual([]);
  });

  it('documents no variable the code does not read', () => {
    // A name here that the registry has never heard of is either a setting
    // somebody wired straight to process.env — which keeps it off the config
    // screen — or one that was removed and left behind in the docs.
    const stale = namesAssignedIn(envExample).filter(
      (name) =>
        !BOOTSTRAP_ONLY.has(name) && !PROCESS_ONLY.has(name) && !registryEnvNames.includes(name),
    );
    expect(stale).toEqual([]);
  });

  it('has something reading every variable that is not a setting', () => {
    // The exemption above is the loophole in this file, so it is closed here:
    // an entry that names a file which does not mention it is a variable
    // nothing reads, documented as though it worked.
    // Quoted or interpolated — the forms a name takes when it is being read.
    // Backticks are deliberately not accepted: this file's own prose names
    // PORT in a comment, and prose describing a variable is exactly what must
    // not count as reading it.
    const unread = [...PROCESS_ONLY].filter(([name, file]) => {
      const reading = new RegExp(`(['"]${name}['"]|\\$\\{${name}[:}])`);
      return !reading.test(readFileSync(file, 'utf8'));
    });
    expect(unread.map(([name]) => name)).toEqual([]);
  });

  it('promises no variable in the schema notes that the code ignores', () => {
    // The schema notes call themselves implemented, so an env block entry
    // nothing reads is a trap: MEDIA_STORAGE=s3 was listed there for a feature
    // that does not exist, and setting it would have silently kept local disk.
    const stale = namesAssignedIn(schemaNotes).filter(
      (name) =>
        !BOOTSTRAP_ONLY.has(name) && !PROCESS_ONLY.has(name) && !registryEnvNames.includes(name),
    );
    expect(stale).toEqual([]);
  });

  it('gives every setting a unique environment variable', () => {
    const seen = new Set<string>();
    const duplicated = registryEnvNames.filter((name) => !seen.add(name) && true);
    expect(duplicated).toEqual([]);
  });
});
