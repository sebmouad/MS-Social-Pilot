import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ScopedPermissions } from '@/server/permissions';

export const SHARE_KINDS = ['review', 'calendar', 'portal'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
/**
 * Who is acting. `allowedTargetIds` and `permissionCeiling` are deny-only ceilings carried by a scoped MCP key:
 * they narrow the member's current channel grants and feature access, never widen them.
 */
export type SharingActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[]; apiKeyId?: string; permissionCeiling?: ScopedPermissions };
/** Result-size ceiling from the MCP key; services never return more rows than this in one page. */
export type SharingReadOptions = { maxItems?: number };

/** 32 random bytes (256 bits), URL-safe. Legacy links used 24 bytes and remain readable. */
export const TOKEN_BYTES = 32;
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;
export const newToken = () => randomBytes(TOKEN_BYTES).toString('base64url');
/** Same digest as the legacy app so migrated links keep working. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const sharePath = (token: string) => `/share/${token}`;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const SLUG_SCHEMA = z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const CREATE_LINK_SCHEMA = z.object({
  kind: z.enum(SHARE_KINDS),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2000).nullish(),
  /** Explicit selection only: an empty list never means "every channel". */
  targetIds: z.array(id).min(1, 'Choose at least one channel for this link.').max(500),
  daysBack: z.number().int().min(0).max(365).default(7),
  daysAhead: z.number().int().min(1).max(365).default(30),
  allowComments: z.boolean().default(true),
  decides: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(730).optional(),
  confirmation: z.string(),
}).strict();
/**
 * Partial edit. `expectedVersion` is the `version` the editor last saw (a fingerprint of the editable fields and the
 * current secret); a mismatch is a conflict, never a silent overwrite. `expiresInDays` renews the lifetime from now.
 * `confirmation` is required only when the change alters access (see ACCESS_FIELDS).
 */
export const UPDATE_LINK_SCHEMA = z.object({
  id,
  expectedVersion: z.string().regex(/^[a-f0-9]{32}$/, 'Reload the link before editing it.'),
  kind: z.enum(SHARE_KINDS).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  targetIds: z.array(id).min(1, 'Choose at least one channel for this link.').max(500).optional(),
  daysBack: z.number().int().min(0).max(365).optional(),
  daysAhead: z.number().int().min(1).max(365).optional(),
  allowComments: z.boolean().optional(),
  decides: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(730).optional(),
  confirmation: z.string().optional(),
}).strict();
export type UpdateLinkInput = z.infer<typeof UPDATE_LINK_SCHEMA>;
/** Changing any of these changes who can see or do what, so the secret address is replaced in the same transaction. */
export const ACCESS_FIELDS = ['kind', 'targetIds', 'daysBack', 'daysAhead', 'allowComments', 'decides', 'expiresInDays'] as const;
export const METADATA_FIELDS = ['title', 'description'] as const;
export const LINK_ACTION_SCHEMA = z.object({ id, confirmation: z.string() }).strict();
export const LIST_QUERY_SCHEMA = z.object({ page: z.number().int().min(1).max(10000).optional() }).strict();
export const FEEDBACK_QUERY_SCHEMA = z.object({ id, page: z.number().int().min(1).max(10000).optional() }).strict();
export const DECISION_SCHEMA = z.object({
  postId: id,
  decision: z.enum(['approved', 'rejected', 'comment']),
  comment: z.string().trim().max(10000).nullish(),
  authorName: z.string().trim().min(1).max(200),
}).strict();

export const BIO_SAVE_SCHEMA = z.object({
  slug: SLUG_SCHEMA,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullish(),
  avatarUrl: z.string().trim().max(4096).nullish(),
  enabled: z.boolean().default(true),
  links: z.array(z.object({ label: z.string().trim().min(1).max(200), url: z.string().trim().min(1).max(4096) }).strict()).max(100),
  confirmation: z.string(),
}).strict();
export const BIO_DELETE_SCHEMA = z.object({ confirmation: z.string() }).strict();

export const createLinkConfirmation = (title: string) => `CREATE SHARE LINK ${title}`;
export const revokeLinkConfirmation = (linkId: string) => `REVOKE SHARE LINK ${linkId}`;
export const updateLinkConfirmation = (linkId: string) => `UPDATE SHARE LINK ${linkId}`;
export const rotateLinkConfirmation =(linkId: string) => `ROTATE SHARE LINK ${linkId}`;
export const deleteLinkConfirmation = (linkId: string) => `DELETE SHARE LINK ${linkId}`;
export const saveBioConfirmation = (slug: string) => `SAVE BIO PAGE ${slug}`;
export const deleteBioConfirmation = (slug: string) => `DELETE BIO PAGE ${slug}`;

/** Links must be absolute http(s) addresses without embedded credentials. */
export function safeUrl(value: string, maxChars: number, httpsOnly = false): string | null {
  if (value.length > maxChars) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || !url.hostname) return null;
  if (url.protocol !== 'https:' && (httpsOnly || url.protocol !== 'http:')) return null;
  return url.toString();
}

export type VersionedLink = { kind: string; title: string; description: string | null; targetIds: readonly string[]; daysBack: number; daysAhead: number; allowComments: boolean; decides: boolean; expiresAt: Date | null; revokedAt: Date | null };
/**
 * Optimistic-concurrency token: a one-way fingerprint of every editable field plus the current secret hash, so an edit,
 * rotation, renewal or revocation by anyone else changes it. It reveals nothing about the secret.
 */
export function linkVersion(row: VersionedLink, tokenHash: string): string {
  const parts = [row.kind, row.title, row.description ?? null, [...row.targetIds].sort(), row.daysBack, row.daysAhead, row.allowComments, row.decides, row.expiresAt ? new Date(row.expiresAt).getTime() : null, row.revokedAt ? new Date(row.revokedAt).getTime() : null, tokenHash];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

export type LinkStatus = 'active' | 'expired' | 'revoked';
export function linkStatus(row: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): LinkStatus {
  if (row.revokedAt) return 'revoked';
  // No expiry recorded (migrated legacy link) is never served, so it is never shown as active.
  return row.expiresAt && row.expiresAt > now ? 'active' : 'expired';
}
