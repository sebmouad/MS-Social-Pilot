import { createHash } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';

export type InboxCursor = {
  v: 1;
  at: string;
  kind: 'message' | 'comment';
  id: string;
  direction: 'older' | 'newer';
  filter: string;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const FILTER_PATTERN = /^[a-f0-9]{64}$/;
const TIMESTAMP_PATTERN = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CURSOR_FIELDS = ['v', 'at', 'kind', 'id', 'direction', 'filter'] as const;

function invalidCursor(): OperationError {
  return new OperationError('invalid_request', 'This Inbox cursor is invalid or no longer matches these filters. Reset to the latest Inbox items.');
}

function validLimit(maxCharacters: number): boolean {
  return Number.isSafeInteger(maxCharacters) && maxCharacters > 0;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validCursor(value: unknown): value is InboxCursor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  const keys = Object.keys(cursor);
  if (keys.length !== CURSOR_FIELDS.length || CURSOR_FIELDS.some(key => !Object.hasOwn(cursor, key))) return false;
  return cursor.v === 1 && validTimestamp(cursor.at) &&
    (cursor.kind === 'message' || cursor.kind === 'comment') &&
    typeof cursor.id === 'string' && ID_PATTERN.test(cursor.id) &&
    (cursor.direction === 'older' || cursor.direction === 'newer') &&
    typeof cursor.filter === 'string' && FILTER_PATTERN.test(cursor.filter);
}

/** Hash the normalized service scope and filters used to produce a page. */
export function inboxFilterFingerprint(input: unknown): string {
  try {
    const serialized = JSON.stringify(input);
    if (typeof serialized !== 'string') throw invalidCursor();
    return createHash('sha256').update(serialized).digest('hex');
  } catch {
    throw invalidCursor();
  }
}

/** Encode a stable tuple anchor. SQL applies (time, kind, id) ordering. */
export function encodeInboxCursor(
  anchor: { time: Date; kind: 'message' | 'comment'; id: string },
  direction: 'older' | 'newer',
  filter: string,
  maxCharacters: number,
): string {
  try {
    if (!validLimit(maxCharacters) || !anchor || !(anchor.time instanceof Date) ||
        !validTimestamp(anchor.time.toISOString()) ||
        (anchor.kind !== 'message' && anchor.kind !== 'comment') ||
        typeof anchor.id !== 'string' || !ID_PATTERN.test(anchor.id) ||
        (direction !== 'older' && direction !== 'newer') ||
        typeof filter !== 'string' || !FILTER_PATTERN.test(filter)) throw invalidCursor();
    const cursor: InboxCursor = { v: 1, at: anchor.time.toISOString(), kind: anchor.kind, id: anchor.id, direction, filter };
    const encoded = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
    if (encoded.length > maxCharacters) throw invalidCursor();
    return encoded;
  } catch {
    throw invalidCursor();
  }
}

/** Decode only canonical, bounded cursors bound to the current filter fingerprint. */
export function readInboxCursor(encoded: unknown, filter: string, maxCharacters: number): InboxCursor | null {
  if (encoded === undefined) return null;
  try {
    if (!validLimit(maxCharacters) || typeof encoded !== 'string' || !encoded ||
        encoded.length > maxCharacters || !/^[A-Za-z0-9_-]+$/.test(encoded) ||
        typeof filter !== 'string' || !FILTER_PATTERN.test(filter)) throw invalidCursor();
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) throw invalidCursor();
    const json = decoded.toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!validCursor(parsed) || parsed.filter !== filter) throw invalidCursor();
    const canonical: InboxCursor = { v: 1, at: parsed.at, kind: parsed.kind, id: parsed.id, direction: parsed.direction, filter: parsed.filter };
    if (JSON.stringify(canonical) !== json) throw invalidCursor();
    return canonical;
  } catch {
    throw invalidCursor();
  }
}
