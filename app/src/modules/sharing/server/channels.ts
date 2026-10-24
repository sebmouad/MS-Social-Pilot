import { Prisma } from '../../../../generated/client';
import type { Tx } from './access';

/** Current selected history remains readable after token expiry, but never after
 * connection invalidation, disconnection, tenant mismatch or platform disable.
 * The provider list is resolved from current enabled and entitled modules by
 * authorizeSharing. Reads remain lock-free. Optional row locks are retained only
 * by mutation transactions, preventing
 * concurrent target deselection or connection invalidation before their commit.
 * Token expiry intentionally does not erase otherwise retained history. */
export async function sharingChannels(db: Pick<Tx, '$queryRaw'>, workspaceId: string, providers: readonly string[], targetIds?: readonly string[], limit?: number, lock = false) {
  return db.$queryRaw<Array<{ id: string; name: string; pictureUrl: string | null }>>`SELECT t.id, t.name, t."pictureUrl" FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t."workspaceId" = ${workspaceId} AND (t.id = ANY(${[...(targetIds ?? [])]}::text[]) OR ${targetIds === undefined}::boolean) AND t.enabled = true AND a."invalidatedAt" IS NULL AND a.provider = ANY(${[...providers]}::text[]) ORDER BY t.name ASC, t.id ASC LIMIT ${limit ?? null} ${lock ? Prisma.sql`FOR SHARE OF t, a` : Prisma.empty}`;
}
