/** Shared credential health; provider renewal and grant rules stay in adapters. */
export type ConnectionHealth = { invalidatedAt: Date | null; tokenExpiresAt: Date | null };
export type ConnectionState = 'connected' | 'expired' | 'revoked';
export type ConnectionStatusLabels = Record<ConnectionState, string>;

export function connectionState(connection: ConnectionHealth, now = new Date()): ConnectionState {
  if (connection.invalidatedAt) return 'revoked';
  if (connection.tokenExpiresAt && connection.tokenExpiresAt <= now) return 'expired';
  return 'connected';
}
