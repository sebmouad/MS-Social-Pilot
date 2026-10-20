import { SYNCHRONOUS_POLICY, synchronousPolicy } from '@/lib/config/synchronous-policy';
import { copySchema } from '@/lib/config/copy-schema';
import { z } from 'zod';
/**
 * Provider-neutral connection health: how long the stored credential stays
 * usable, and which customer-facing permission groups the platform module says
 * are granted. Permission names, scope lists and provider rules stay in the
 * module; this file only combines what the module reports.
 */
export type ConnectionTokenStatus = 'valid' | 'expiring_soon' | 'expired' | 'reconnect_needed';

/** Registered bootstrap default; server consumers read the refreshed Root snapshot below. */
export const DEFAULT_EXPIRY_WARNING_DAYS = SYNCHRONOUS_POLICY['connections.expiryWarningDays'].defaultValue;

export type GrantGroupState = 'granted' | 'missing' | 'unknown';
/** One permission area in customer words, supplied by the platform module. */
export interface GrantGroupHealth { id: string; label: string; state: GrantGroupState }

export interface TokenHealthInput { invalidatedAt: Date | null; tokenExpiresAt: Date | null }

export function connectionTokenStatus(connection: TokenHealthInput, now = new Date(), warningDays = synchronousPolicy('connections.expiryWarningDays')): ConnectionTokenStatus {
  if (connection.invalidatedAt) return 'reconnect_needed';
  if (!connection.tokenExpiresAt) return 'valid';
  const remainingMs = connection.tokenExpiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return 'expired';
  return remainingMs <= warningDays * 86_400_000 ? 'expiring_soon' : 'valid';
}

export interface ConnectionHealthSummary {
  token: ConnectionTokenStatus;
  grants: GrantGroupHealth[];
  missing: GrantGroupHealth[];
  /** Offer Reconnect: the credential is unusable, about to lapse, or lacks a needed permission. */
  reconnectRecommended: boolean;
  /** Time the status was worked out from stored data; it is not a provider round trip. */
  checkedAt: Date;
}

export function summarizeConnectionHealth(connection: TokenHealthInput, grants: readonly GrantGroupHealth[], now = new Date(), warningDays = synchronousPolicy('connections.expiryWarningDays')): ConnectionHealthSummary {
  const token = connectionTokenStatus(connection, now, warningDays);
  const missing = grants.filter(group => group.state === 'missing');
  return { token, grants: [...grants], missing, reconnectRecommended: token !== 'valid' || missing.length > 0, checkedAt: now };
}

export const connectionHealthCopy = {
  en: {
    'token.valid': 'Valid', 'token.expiring_soon': 'Expires soon', 'token.expired': 'Expired', 'token.reconnect_needed': 'Reconnect needed',
    'token.expiresOn': 'Access ends {date}', 'token.noExpiry': 'No expiry date recorded',
    permissions: 'Permissions', allGranted: 'All needed permissions granted', granted: 'Allowed', missing: 'Not allowed', unknown: 'Not recorded',
    missingSummary: 'Missing: {labels}', unknownSummary: 'Permissions were not recorded. Reconnect to refresh them.',
    checked: 'Checked {date}', checkedHint: 'Worked out from what was stored at connection time; Reconnect to refresh it.',
    reconnect: 'Reconnect', reconnecting: 'Reconnecting…', reconnectFailed: 'Could not start reconnecting. Try again.',
  },
  fr: {
    'token.valid': 'Valide', 'token.expiring_soon': 'Expire bientôt', 'token.expired': 'Expiré', 'token.reconnect_needed': 'Reconnexion nécessaire',
    'token.expiresOn': 'Accès jusqu’au {date}', 'token.noExpiry': 'Aucune date d’expiration enregistrée',
    permissions: 'Autorisations', allGranted: 'Toutes les autorisations nécessaires sont accordées', granted: 'Autorisé', missing: 'Non autorisé', unknown: 'Non enregistré',
    missingSummary: 'Manquant : {labels}', unknownSummary: 'Les autorisations n’ont pas été enregistrées. Reconnectez pour les actualiser.',
    checked: 'Vérifié {date}', checkedHint: 'Calculé à partir de ce qui a été enregistré à la connexion ; reconnectez pour l’actualiser.',
    reconnect: 'Reconnecter', reconnecting: 'Reconnexion…', reconnectFailed: 'Impossible de lancer la reconnexion. Réessayez.',
  },
} as const;
export type ConnectionHealthLocale = keyof typeof connectionHealthCopy;
export type ConnectionHealthCopyKey = keyof typeof connectionHealthCopy.en;
export function connectionHealthText(locale: ConnectionHealthLocale, key: ConnectionHealthCopyKey, values: Record<string, string | number> = {}): string {
  return ((healthCopyState.value ?? connectionHealthCopy)[locale][key] as string).replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}


export const connectionHealthCopySchema = z.object({ en: copySchema(connectionHealthCopy.en), fr: copySchema(connectionHealthCopy.fr) }).strict();
type HealthCopy = z.infer<typeof connectionHealthCopySchema>;
const healthCopyState = ((globalThis as { __mspConnectionHealthCopy?: { value?: HealthCopy } }).__mspConnectionHealthCopy ??= {});
/** Updated by the server's startup/periodic refresh and after a local Root save. */
export function applyConnectionHealthCopy(value: unknown): void {
  healthCopyState.value = connectionHealthCopySchema.parse(value);
}
