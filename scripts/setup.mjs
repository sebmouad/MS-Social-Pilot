#!/usr/bin/env node
/**
 * First-run bootstrap.
 *
 * Creates .env from .env.example and fills the two values that cannot be
 * guessed and must not be shared between installations: the session signing
 * secret and the token encryption key. Everything else in .env has a working
 * default or is configured later from Settings inside the app.
 *
 * Safe to run more than once. An existing .env is never overwritten; only
 * blank secrets are filled in, and a line that already has a value is left
 * exactly as it is.
 */

import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');

/** Values generated per installation, with the size each one needs. */
const SECRETS = {
  SESSION_SECRET: () => randomBytes(48).toString('base64'),
  // Exactly 32 bytes: AES-256-GCM takes no other key length.
  ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
};

function fillBlankSecrets(text) {
  const filled = [];

  let next = text;
  for (const [name, generate] of Object.entries(SECRETS)) {
    // Only an empty value. A key already in use must never be regenerated:
    // rotating ENCRYPTION_KEY makes every stored Facebook token unreadable.
    const blank = new RegExp(`^${name}=["']?["']?$`, 'm');
    if (blank.test(next)) {
      next = next.replace(blank, `${name}="${generate()}"`);
      filled.push(name);
    }
  }

  return { text: next, filled };
}

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error('No .env.example found. Run this from the project root.');
    process.exit(1);
  }
  copyFileSync(examplePath, envPath);
  console.log('Created .env from .env.example');
}

const { text, filled } = fillBlankSecrets(readFileSync(envPath, 'utf8'));
if (filled.length > 0) {
  writeFileSync(envPath, text);
  console.log(`Generated ${filled.join(' and ')}`);
} else {
  console.log('Secrets already set — left untouched');
}

console.log(`
Next:

  1. docker compose up -d          start Postgres, the app and the worker
  2. open http://localhost:3000    create the first account, which is the owner
  3. follow the setup screen       it asks for your Meta app ID and secret

Running without Docker instead:

  createdb social_pilot            or point DATABASE_URL at any Postgres 16
  npm run db:migrate               create the schema
  npm run dev                      the app, on port 3000
  npm run worker                   the scheduler, in a second terminal
`);
