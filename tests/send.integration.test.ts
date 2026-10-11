import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailStatus } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Actually sending, and writing down what happened.
 *
 * Two rules hold this module together, and both are the kind that only show up
 * when something is already going wrong. Sending must never break the thing
 * that triggered it — a failed alert about a post that did not publish must not
 * also crash the worker. And every attempt is recorded, because "why was I not
 * told my posts stopped going out?" is a question asked days later, when the
 * only evidence left is the log.
 */

/** What the fake provider was asked to send, and what it should answer. */
let sent: Array<{ to: string; subject: string; from: string }> = [];
let answer: { data?: { id: string }; error?: { message: string } } = { data: { id: 'msg_1' } };
let throwInstead: Error | null = null;

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (request: { to: string; subject: string; from: string }) => {
        if (throwInstead) throw throwInstead;
        sent.push(request);
        return answer;
      },
    };
  },
}));

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let send: typeof import('../src/lib/email/send');
let settings: typeof import('../src/lib/settings');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('send');

  ({ prisma } = await import('../src/lib/prisma'));
  send = await import('../src/lib/email/send');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  sent = [];
  answer = { data: { id: 'msg_1' } };
  throwInstead = null;
  await prisma.emailLog.deleteMany();
  await settings.clearSetting('email.apiKey');
  await settings.ensureSettings();
});

/** Configure a provider for the duration of one test. */
async function withProvider(body: () => Promise<void>) {
  await settings.writeSetting('email.apiKey', 're_test_key', null);
  await settings.ensureSettings();
  try {
    await body();
  } finally {
    await settings.clearSetting('email.apiKey');
    await settings.ensureSettings();
  }
}

const message = () => ({
  to: `someone-${randomBytes(3).toString('hex')}@example.com`,
  subject: 'A post failed to publish',
  html: '<p>It failed.</p>',
  text: 'It failed.',
  template: 'publishFailure',
});

describe('with no provider configured', () => {
  it('records the message as skipped rather than pretending it went', async () => {
    // Local development needs no email account, but the log must not claim a
    // message was delivered when nothing was.
    const result = await send.sendEmail(message());

    expect(result.status).toBe(EmailStatus.skipped);
    expect(sent).toHaveLength(0);

    const log = await prisma.emailLog.findFirstOrThrow();
    expect(log.status).toBe(EmailStatus.skipped);
    expect(log.error).toMatch(/No email provider/);
  });

  it('reports that email is not available', async () => {
    expect(send.emailEnabled()).toBe(false);
  });
});

describe('with a provider', () => {
  it('sends, and keeps the provider\'s id', async () => {
    await withProvider(async () => {
      const outgoing = message();
      const result = await send.sendEmail(outgoing);

      expect(result.status).toBe(EmailStatus.sent);
      expect(result.providerId).toBe('msg_1');
      expect(sent[0]?.to).toBe(outgoing.to);

      // The id is what a provider's support desk asks for.
      const log = await prisma.emailLog.findFirstOrThrow();
      expect(log.providerId).toBe('msg_1');
      expect(log.status).toBe(EmailStatus.sent);
    });
  });

  it('says who it is from', async () => {
    await withProvider(async () => {
      await send.sendEmail(message());
      expect(sent[0]?.from).toBeTruthy();
    });
  });

  it('records a refusal as failed, with the reason', async () => {
    await withProvider(async () => {
      answer = { error: { message: 'The domain is not verified.' } };

      const result = await send.sendEmail(message());

      expect(result.status).toBe(EmailStatus.failed);
      expect(result.error).toMatch(/not verified/);

      // The answer to "why did nobody hear about it", months later.
      const log = await prisma.emailLog.findFirstOrThrow();
      expect(log.status).toBe(EmailStatus.failed);
      expect(log.error).toMatch(/not verified/);
    });
  });

  it('turns a provider that throws into a recorded failure', async () => {
    // Not a crash: this is called from inside a publish, and an unreachable
    // email provider must not become a failed post.
    await withProvider(async () => {
      throwInstead = new Error('socket hang up');

      const result = await send.sendEmail(message());

      expect(result.status).toBe(EmailStatus.failed);
      expect(result.error).toMatch(/socket hang up/);
    });
  });

  it('reports that email is available', async () => {
    await withProvider(async () => {
      expect(send.emailEnabled()).toBe(true);
    });
  });
});

describe('when the log itself cannot be written', () => {
  it('still reports the outcome rather than throwing', async () => {
    // Losing the record is bad; losing the send because the record failed
    // would be worse.
    const spy = vi
      .spyOn(prisma.emailLog, 'create')
      .mockRejectedValueOnce(new Error('database is having a moment'));

    await withProvider(async () => {
      const result = await send.sendEmail(message());
      expect(result.status).toBe(EmailStatus.sent);
    });

    spy.mockRestore();
  });
});
