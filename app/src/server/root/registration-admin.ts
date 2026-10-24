import { synchronousPolicy, withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { Prisma } from '../../../generated/client';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { assertRootActor, lockRootActor, invalid } from '@/modules/root/server/admin/authz';
import { rootTransaction, adminSetting, rootResultLimit } from '@/modules/root/server/admin/policy';
import { writeRootAudit } from '@/modules/root/server/admin/audit';
import { invitationStatusSql as statusSql, revokeInstallationInvitation } from '@/modules/settings/server/invitations';
import { deleteUnverifiedRegistration, resendUnverifiedRegistration, unverifiedRegistrationWhere } from '@/modules/settings/server/registration';

const identifier = z.string().min(1).regex(/^[^\u0000-\u001f\u007f]+$/).refine(withinSynchronousLimit('root.registrationIdentifierMaxCharacters'));
const filters = z.object({
  q: z.string().trim().optional(), workspaceId: identifier.optional(),
  status: z.enum(['pending', 'expired', 'accepted']).optional(),
  page: z.coerce.number().int().min(1).refine(value => value <= synchronousPolicy('root.pageMaxNumber')).default(1),
  accountsPage: z.coerce.number().int().min(1).refine(value => value <= synchronousPolicy('root.pageMaxNumber')).default(1),
}).strict();
const confirmationSchema = z.object({ confirmation: z.string().refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict();
export const registrationConfirmation = (action: 'resend' | 'delete', userId: string) => `${action === 'resend' ? 'RESEND VERIFICATION' : 'DELETE UNVERIFIED ACCOUNT'} ${userId}`;

type Invitation = { id: string; workspaceId: string; workspaceName: string; email: string; role: string; createdAt: Date; expiresAt: Date; acceptedAt: Date | null; status: 'pending' | 'expired' | 'accepted' };
type Account = { id: string; name: string; email: string; createdAt: Date; disabledAt: Date | null };

/** One private service for the page, HTTP and installation MCP callers; returns no credentials or token metadata. */
export async function listRootRegistration(actorId: string, input: unknown = {}, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const parsed = filters.safeParse(input);
  const max = await adminSetting('root.admin.searchMaxCharacters');
  if (!parsed.success || (parsed.data.q?.length ?? 0) > max) throw invalid('Choose valid registration filters.');
  const { q = '', workspaceId, status, page, accountsPage } = parsed.data;
  const limit = rootResultLimit(await adminSetting('root.admin.lifecycleListLimit'), resultCap);
  const literal = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const [openRegistration, invitations, accounts] = await Promise.all([
    runtimeConfig('auth.openRegistration'),
    prisma.$queryRaw<Invitation[]>(Prisma.sql`SELECT i.id, i."workspaceId", w.name AS "workspaceName", i.email, i.role::text AS role,
      i."createdAt", i."expiresAt", i."acceptedAt", ${statusSql} AS status
      FROM invitations i JOIN workspaces w ON w.id = i."workspaceId"
      WHERE (i.email ILIKE ${literal} OR w.name ILIKE ${literal})
      ${workspaceId ? Prisma.sql`AND i."workspaceId" = ${workspaceId}` : Prisma.empty}
      ${status ? Prisma.sql`AND (${statusSql}) = ${status}` : Prisma.empty}
      ORDER BY i."createdAt" DESC, i.id DESC LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`),
    prisma.$queryRaw<Account[]>(Prisma.sql`SELECT u.id, u.name, u.email, u."createdAt", u."disabledAt" FROM users u
      WHERE ${unverifiedRegistrationWhere} AND (u.email ILIKE ${literal} OR u.name ILIKE ${literal})
      ORDER BY u."createdAt" DESC, u.id DESC LIMIT ${limit + 1} OFFSET ${(accountsPage - 1) * limit}`),
  ]);
  if (typeof openRegistration !== 'boolean') throw new OperationError('unavailable', 'Registration configuration is unavailable.');
  return { openRegistration, invitations: invitations.slice(0, limit), accounts: accounts.slice(0, limit),
    moreInvitations: invitations.length > limit, moreAccounts: accounts.length > limit,
    page, accountsPage, limit, searchMaxCharacters: max };
}

export async function revokeRootRegistrationInvitation(actorId: string, workspaceId: string, id: string, input: unknown) {
  await assertRootActor(prisma, actorId);
  if (!identifier.safeParse(workspaceId).success || !identifier.safeParse(id).success) throw invalid();
  const value = confirmationSchema.safeParse(input);
  if (!value.success) throw invalid();
  return revokeInstallationInvitation(actorId, workspaceId, { id, confirmation: value.data.confirmation });
}

export async function controlRootRegistrationAccount(actorId: string, userId: string, action: 'resend' | 'delete', input: unknown) {
  await assertRootActor(prisma, actorId);
  const value = confirmationSchema.safeParse(input);
  if (!identifier.safeParse(userId).success || !['resend', 'delete'].includes(action) || !value.success
    || value.data.confirmation !== registrationConfirmation(action, userId)) throw invalid('Enter the exact confirmation shown.');
  return rootTransaction(async tx => {
    await lockRootActor(tx, actorId, [userId]);
    const result = action === 'delete' ? await deleteUnverifiedRegistration(tx, userId) : await resendUnverifiedRegistration(tx, userId);
    await writeRootAudit(tx, actorId, action === 'delete' ? 'root.unverified_registration_deleted' : 'root.registration_verification_resent',
      { userId, ...('delivery' in result ? { delivery: result.delivery } : {}) });
    return { ...result, userId };
  });
}
