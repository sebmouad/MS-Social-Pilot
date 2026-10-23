/** Freshness of the stored inbox against the Root staleness threshold. Stored facts only: never a provider read. */
export function inboxSyncStale(lastSynced: Date | null, staleAfterMinutes: number, now = new Date()): boolean {
  // Never-synced scopes have their own honest state; they are not "stale".
  if (!lastSynced || !Number.isFinite(staleAfterMinutes) || staleAfterMinutes <= 0) return false;
  return now.getTime() - lastSynced.getTime() > staleAfterMinutes * 60_000;
}
