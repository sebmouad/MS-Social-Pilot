import { OperationError } from '@/lib/operation-error';
import type { InsightRow } from '@/modules/ads/server/summary';

export type AdsDailyRow = {
  id: string;
  accountId: string;
  accountName: string;
  currency: string | null;
  level: string;
  objectId: string;
  objectName: string | null;
  date: string;
  fetchedAt: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  cpc: number | null;
  cpm: number | null;
  cpp: number | null;
  ctr: number | null;
  frequency: number | null;
  actions: unknown;
  fields: unknown;
  redactedPaths: string[];
};

const SAFE_UNAVAILABLE = 'Advertising report data is temporarily unavailable.';
const REDACTED = '[REDACTED]';
const CREDENTIAL_KEYS = new Set([
  'authorization', 'clientsecret', 'appsecret', 'password', 'passwd', 'cookie', 'setcookie', 'secret', 'token',
  'apikey', 'privatekey', 'signingkey', 'secretkey', 'accesskey', 'authkey', 'consumerkey', 'clientkey', 'appkey', 'oauthkey',
  'credential', 'credentials', 'signature', 'sig', 'oauthsignature', 'xamzsignature',
]);

function failClosed(): never {
  throw new OperationError('unavailable', SAFE_UNAVAILABLE);
}

function isCredentialKey(key: string, context: 'json' | 'url-query' = 'json') {
  // Match common snake_case, kebab-case and camelCase credential names while
  // leaving metric names such as token_count and arbitrary JSON key fields intact.
  const normalized = key.toLowerCase().replace(/[^a-z\d]/g, '');
  if (normalized === 'key') return context === 'url-query';
  return CREDENTIAL_KEYS.has(normalized)
    || /(?:access|refresh|id|auth|bearer|session|api|oauth)?token$/.test(normalized)
    || /(?:authorization|secret|password|passwd|cookie)$/.test(normalized)
    || /(?:api|private|signing|secret|access|auth|consumer|client|app|oauth)key$/.test(normalized)
    || /credentials?$/.test(normalized)
    || /signature$/.test(normalized);
}

function pathFor(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function sanitizeUrl(value: string, path: string, redactedPaths: string[]): string {
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const protocolRelative = value.startsWith('//');
  if (!absolute && !protocolRelative) return value;
  let url: URL;
  try { url = new URL(value, protocolRelative ? 'https://ads-report.invalid' : undefined); } catch { failClosed(); }
  if (url.username || url.password) {
    url.username = REDACTED;
    url.password = '';
    redactedPaths.push(`${path}.<userinfo>`);
  }
  const safeParams = new URLSearchParams();
  const sensitiveQueryKeys = new Set<string>();
  for (const [key, item] of url.searchParams) {
    if (isCredentialKey(key, 'url-query')) {
      safeParams.append(key, REDACTED);
      sensitiveQueryKeys.add(key);
    } else safeParams.append(key, item);
  }
  if (sensitiveQueryKeys.size) {
    url.search = safeParams.toString();
    for (const key of sensitiveQueryKeys) redactedPaths.push(`${path}.<query:${key}>`);
  }
  if (url.hash) {
    url.hash = REDACTED;
    redactedPaths.push(`${path}.<fragment>`);
  }
  const safeUrl = url.href.replaceAll('%5BREDACTED%5D', REDACTED);
  return protocolRelative ? safeUrl.replace(/^https:/i, '') : safeUrl;
}

/**
 * Redact credential-like JSON keys and URL components while retaining unrelated values.
 * This is a name-based heuristic: unknown provider aliases or credentials embedded in
 * opaque strings may remain, while ambiguous URL query keys such as `key` are scrubbed.
 * Callers receive paths for each replacement so export consumers can see what changed.
 */
export function sanitizeAdsReportJson(value: unknown, prefix = '$'): { value: unknown; redactedPaths: string[] } {
  const redactedPaths: string[] = [];
  const root: { value?: unknown } = Object.create(null);
  const active = new WeakSet<object>();
  const stack: Array<{ source: unknown; parent: Record<string, unknown> | unknown[]; key: string | number; path: string; exiting?: object }> = [
    { source: value, parent: root, key: 'value', path: prefix },
  ];
  try {
    while (stack.length) {
      const frame = stack.pop()!;
      if (frame.exiting) {
        active.delete(frame.exiting);
        continue;
      }
      const { source, parent, key, path } = frame;
      if (source === null || typeof source === 'boolean' || typeof source === 'string') {
        Object.defineProperty(parent, String(key), { value: typeof source === 'string' ? sanitizeUrl(source, path, redactedPaths) : source, enumerable: true, configurable: true, writable: true });
        continue;
      }
      if (typeof source === 'number') {
        if (!Number.isFinite(source)) failClosed();
        Object.defineProperty(parent, String(key), { value: source, enumerable: true, configurable: true, writable: true });
        continue;
      }
      if (typeof source !== 'object' || source === null) failClosed();
      if (active.has(source)) failClosed();
      if (Array.isArray(source)) {
        if (Object.getOwnPropertySymbols(source).length || Object.keys(source).length !== source.length) failClosed();
        const target: unknown[] = new Array(source.length);
        Object.defineProperty(parent, String(key), { value: target, enumerable: true, configurable: true, writable: true });
        active.add(source);
        stack.push({ source, parent, key, path, exiting: source });
        for (let index = source.length - 1; index >= 0; index--) stack.push({ source: source[index], parent: target, key: index, path: pathFor(path, index) });
        continue;
      }
      const prototype = Object.getPrototypeOf(source);
      if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(source).length) failClosed();
      const target: Record<string, unknown> = Object.create(null);
      Object.defineProperty(parent, String(key), { value: target, enumerable: true, configurable: true, writable: true });
      active.add(source);
      stack.push({ source, parent, key, path, exiting: source });
      const entries = Object.entries(source as Record<string, unknown>);
      const secretPaths: string[] = [];
      for (let index = entries.length - 1; index >= 0; index--) {
        const [childKey, child] = entries[index];
        const childPath = pathFor(path, childKey);
        if (isCredentialKey(childKey)) {
          secretPaths.push(childPath);
          Object.defineProperty(target, childKey, { value: REDACTED, enumerable: true, configurable: true, writable: true });
        } else {
          stack.push({ source: child, parent: target, key: childKey, path: childPath });
        }
      }
      redactedPaths.push(...secretPaths.reverse());
    }
    return { value: root.value, redactedPaths };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    failClosed();
  }
}

function requiredString(value: unknown): value is string { return typeof value === 'string'; }
function requiredFinite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function nullableString(value: unknown): value is string | null { return value === null || requiredString(value); }
function nullableFinite(value: unknown): value is number | null { return value === null || requiredFinite(value); }

/** Convert a stored insight row into the stable, lossless daily report shape. */
export function normalizeAdsDailyRow(row: InsightRow): AdsDailyRow {
  if (!row || typeof row !== 'object' || !row.adAccount || typeof row.adAccount !== 'object') failClosed();
  if (![row.id, row.adAccountId, row.level, row.objectId, row.adAccount.id, row.adAccount.name].every(requiredString)) failClosed();
  if (!nullableString(row.objectName) || !nullableString(row.adAccount.currency)) failClosed();
  if (!(row.date instanceof Date) || !Number.isFinite(row.date.getTime())) failClosed();
  const fetchedAt = row.fetchedAt === undefined || row.fetchedAt === null
    ? null
    : row.fetchedAt instanceof Date && Number.isFinite(row.fetchedAt.getTime())
      ? row.fetchedAt.toISOString()
      : failClosed();
  if (![row.spend, row.impressions, row.clicks, row.reach].every(requiredFinite)) failClosed();
  if (![row.cpc, row.cpm, row.cpp, row.ctr, row.frequency].every(nullableFinite)) failClosed();
  const actions = sanitizeAdsReportJson(row.actions, '$.actions');
  const fields = sanitizeAdsReportJson(row.fields, '$.fields');
  return {
    id: row.id, accountId: row.adAccount.id, accountName: row.adAccount.name, currency: row.adAccount.currency,
    level: row.level, objectId: row.objectId, objectName: row.objectName, date: row.date.toISOString(), fetchedAt,
    spend: row.spend, impressions: row.impressions, clicks: row.clicks, reach: row.reach,
    cpc: row.cpc, cpm: row.cpm, cpp: row.cpp, ctr: row.ctr, frequency: row.frequency,
    actions: actions.value, fields: fields.value, redactedPaths: [...actions.redactedPaths, ...fields.redactedPaths],
  };
}
