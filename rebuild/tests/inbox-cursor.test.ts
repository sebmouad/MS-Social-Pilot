import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OperationError } from '../src/lib/operation-error';
import { encodeInboxCursor, inboxFilterFingerprint, readInboxCursor, type InboxCursor } from '../src/modules/inbox/server/cursor';

const filter = 'a'.repeat(64);
const anchor = { time: new Date('2026-10-16T01:02:03.004Z'), kind: 'message' as const, id: 'thread_1' };
const MAX = 1024;
const encode = (cursor: Record<string, unknown>, json = JSON.stringify(cursor)) => Buffer.from(json, 'utf8').toString('base64url');
const validCursor: InboxCursor = { v: 1, at: anchor.time.toISOString(), kind: anchor.kind, id: anchor.id, direction: 'older', filter };

function expectInvalid(run: () => unknown) {
  let thrown: unknown;
  try { run(); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(OperationError);
  expect(thrown).toMatchObject({
    code: 'invalid_request',
    message: expect.stringContaining('Reset to the latest Inbox items.'),
  });
}

describe('Inbox cursor codec', () => {
  it('fingerprints the exact JSON serialization with SHA-256', () => {
    const input = { workspaceId: 'workspace-a', targetIds: ['page-a'], status: 'open' };
    expect(inboxFilterFingerprint(input)).toBe(createHash('sha256').update(JSON.stringify(input)).digest('hex'));
    expect(inboxFilterFingerprint(input)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(['message', 'comment'] as const)('round trips %s anchors in both directions', kind => {
    for (const direction of ['older', 'newer'] as const) {
      const value = encodeInboxCursor({ ...anchor, kind }, direction, filter, MAX);
      expect(readInboxCursor(value, filter, MAX)).toEqual({ ...validCursor, kind, direction });
    }
  });

  it('returns null only when the cursor is omitted', () => {
    expect(readInboxCursor(undefined, filter, MAX)).toBeNull();
    for (const value of [null, '', [], {}, 12]) expectInvalid(() => readInboxCursor(value, filter, MAX));
  });

  it('rejects malformed base64url, JSON, and noncanonical encodings', () => {
    for (const value of ['%', 'AA=', encode(validCursor, '{'), encode(validCursor, ` ${JSON.stringify(validCursor)}`)]) {
      expectInvalid(() => readInboxCursor(value, filter, MAX));
    }
    const noncanonicalJsonOrder = { at: validCursor.at, v: 1, kind: validCursor.kind, id: validCursor.id, direction: validCursor.direction, filter };
    expectInvalid(() => readInboxCursor(encode(noncanonicalJsonOrder), filter, MAX));
  });

  it('rejects wrong version, unknown fields, and malformed values', () => {
    for (const patch of [
      { v: 2 }, { extra: true }, { kind: 'review' }, { direction: 'latest' }, { id: 'not valid' },
      { id: 'x'.repeat(201) }, { filter: 'A'.repeat(64) }, { filter: 'short' },
    ]) {
      expectInvalid(() => readInboxCursor(encode({ ...validCursor, ...patch }), filter, MAX));
    }
  });

  it('rejects noncanonical, rollover, and zero-year timestamps', () => {
    for (const at of [
      '2026-10-16T01:02:03Z', '2026-10-16T01:02:03.04Z',
      '2026-02-30T01:02:03.004Z', '0000-01-01T00:00:00.000Z',
      '2026-10-16T01:02:03.004+00:00',
    ]) {
      expectInvalid(() => readInboxCursor(encode({ ...validCursor, at }), filter, MAX));
    }
    expect(readInboxCursor(encode({ ...validCursor, at: '0001-01-01T00:00:00.000Z' }), filter, MAX)).toMatchObject({ at: '0001-01-01T00:00:00.000Z' });
  });

  it('rejects cursors for another filter and bounded-size violations', () => {
    const value = encodeInboxCursor(anchor, 'older', filter, MAX);
    expectInvalid(() => readInboxCursor(value, 'b'.repeat(64), MAX));
    expectInvalid(() => readInboxCursor(value, filter, value.length - 1));
    expectInvalid(() => readInboxCursor(value, filter, 0));
    expectInvalid(() => encodeInboxCursor(anchor, 'older', filter, value.length - 1));
  });

  it('validates serialization anchors and fingerprints before encoding', () => {
    expectInvalid(() => encodeInboxCursor({ ...anchor, time: new Date(Number.NaN) }, 'older', filter, MAX));
    expectInvalid(() => encodeInboxCursor({ ...anchor, id: 'bad id' }, 'older', filter, MAX));
    expectInvalid(() => encodeInboxCursor(anchor, 'sideways' as 'older', filter, MAX));
    expectInvalid(() => encodeInboxCursor(anchor, 'older', 'bad-filter', MAX));
    expectInvalid(() => inboxFilterFingerprint(undefined));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expectInvalid(() => inboxFilterFingerprint(circular));
  });
});
