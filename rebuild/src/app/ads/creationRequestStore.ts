/**
 * Tab-scoped memory of one in-flight Ads creation request. It lets a reload after a lost response
 * restore the ORIGINAL request id and reviewed payload so the user can only re-check that same
 * request, never silently send a new one. Holds names, numbers and the reviewed confirmation text; no credentials.
 *
 * `transmissions` counts how many times this request id has been sent. Only an identity that has been
 * sent exactly once may be released by a refusal; any further send leaves it held until an authoritative
 * recorded outcome, because an earlier send may have been recorded or dispatched without us seeing the reply.
 */
export type StoredCreation<T extends object> = { requestId: string; request: T; transmissions: number };
/** Who owns the stored request: another user or workspace in the same tab never sees or reuses it. */
export type CreationOwnerScope = { userId: string; workspaceId: string };
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

const keyOf = (kind: 'campaign' | 'adset', owner: CreationOwnerScope, scope: string) =>
  `ads-creation-pending:v2:${kind}:${encodeURIComponent(owner.userId)}:${encodeURIComponent(owner.workspaceId)}:${scope}`;

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

export function saveCreation<T extends object>(kind: 'campaign' | 'adset', owner: CreationOwnerScope, scope: string, requestId: string, request: T, transmissions: number) {
  try {
    const store = storage();
    if (!store) return false;
    const key = keyOf(kind, owner, scope);
    const value = JSON.stringify({ requestId, request, transmissions });
    store.setItem(key, value);
    return store.getItem(key) === value;
  } catch { return false; }
}

export function clearCreation(kind: 'campaign' | 'adset', owner: CreationOwnerScope, scope: string) {
  try { storage()?.removeItem(keyOf(kind, owner, scope)); } catch { /* nothing to clear */ }
}

/** Returns the stored record only when its shape validates; malformed data is discarded. */
export function loadCreation<T extends object>(kind: 'campaign' | 'adset', owner: CreationOwnerScope, scope: string, valid: (value: Record<string, unknown>) => boolean): StoredCreation<T> | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(keyOf(kind, owner, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { requestId?: unknown; request?: unknown; transmissions?: unknown };
    const request = parsed.request;
    if (typeof parsed.requestId === 'string' && REQUEST_ID.test(parsed.requestId) && request && typeof request === 'object' && valid(request as Record<string, unknown>)) {
      // A stored request was sent at least once and its reply is unknown; a missing count never reads as "unsent".
      const transmissions = typeof parsed.transmissions === 'number' && Number.isSafeInteger(parsed.transmissions) && parsed.transmissions >= 1 ? parsed.transmissions : 1;
      return { requestId: parsed.requestId, request: request as T, transmissions };
    }
  } catch { /* fall through to discard */ }
  clearCreation(kind, owner, scope);
  return null;
}
