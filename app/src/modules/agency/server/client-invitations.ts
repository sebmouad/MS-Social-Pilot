import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { sendTransactionalMail } from '@/server/mail';
import { OperationError } from '@/lib/operation-error';
import { assertRootActor, lockRootActor } from '@/modules/root/server/admin/authz';
import { clientInvitationPolicySchema, clientInvitationCopySchema, clientInviteConfirmation, clientRevokeConfirmation } from '../invitation-policy';

export { clientInviteConfirmation, clientRevokeConfirmation } from '../invitation-policy';
type Tx = import('../../../../generated/client').Prisma.TransactionClient;
type StoredInvitation = { id: string; email: string; workspaceName: string | null; expiresAt: Date; acceptedAt: Date | null; createdAt: Date };
export type ClientInvitationSummary = { id: string; email: string; workspaceName: string | null; expiresAt: string; createdAt: string; status: 'accepted' | 'expired' | 'pending' };
const invalid = () => new OperationError('invalid_request', 'Choose valid client invitation details and matching confirmation.');

async function policy() {
  const parsed = clientInvitationPolicySchema.safeParse(await runtimeConfig('agency.clientInvitationPolicy'));
  if (!parsed.success) throw new OperationError('unavailable', 'Client invitation policy is unavailable.');
  return parsed.data;
}
export async function loadClientInvitationCopy(locale: 'en' | 'fr') {
  const copy = clientInvitationCopySchema.safeParse(await runtimeConfig('agency.clientInvitationCopy'));
  if (!copy.success) throw new OperationError('unavailable', 'Client invitation copy is unavailable.');
  return copy.data[locale];
}

async function audit(tx: Tx, actorId: string, action: string, invitationId: string, delivery?: string) {
  // No token, invitation URL, recipient address or private SMTP detail in activity.
  const count = await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${action}, ${JSON.stringify({ invitationId, ...(delivery ? { delivery } : {}) })}::jsonb, NOW())`;
  if (count !== 1) throw new OperationError('unavailable', 'The invitation action could not be recorded.');
}

/** Root-only, installation-wide. Workspace ownership never grants this directory. */
export async function listClientInvitations(actorId: string) {
  await assertRootActor(prisma, actorId);
  const config = await policy();
  const rows = await prisma.$queryRaw<StoredInvitation[]>`SELECT id, email, "workspaceName", "expiresAt", "acceptedAt", "createdAt" FROM client_invitations ORDER BY "createdAt" DESC, id DESC LIMIT ${config.listLimit + 1}`;
  const now = new Date();
  const invitations: ClientInvitationSummary[] = rows.slice(0, config.listLimit).map(item => ({ id: item.id, email: item.email, workspaceName: item.workspaceName, expiresAt: item.expiresAt.toISOString(), createdAt: item.createdAt.toISOString(), status: item.acceptedAt ? 'accepted' : item.expiresAt <= now ? 'expired' : 'pending' }));
  await assertRootActor(prisma, actorId);
  return { invitations, truncated: rows.length > config.listLimit, policy: config };
}

/** Preserves existing pending-invitation replacement and direct-link delivery, with atomic authority and audit. */
export async function issueClientInvitation(actorId: string, input: unknown) {
  await assertRootActor(prisma, actorId);
  const config = await policy();
  if (!config.enabled) throw new OperationError('forbidden', 'New client invitations are unavailable.');
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(config.emailMaxLength), workspaceName: z.string().trim().max(config.workspaceNameMaxLength).optional(), locale: z.enum(['en', 'fr']).default('en'), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success) throw invalid();
  const { email, locale } = parsed.data;
  const workspaceName = parsed.data.workspaceName || null;
  if (parsed.data.confirmation !== clientInviteConfirmation(email, workspaceName)) throw invalid();
  const [originValue, copy] = await Promise.all([runtimeConfig('app.publicOrigin'), loadClientInvitationCopy(locale)]);
  let origin: URL;
  try { origin = new URL(String(originValue)); } catch { throw new OperationError('unavailable', 'The public application address is unavailable.'); }
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new OperationError('unavailable', 'The public application address is invalid.');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + config.lifetimeDays * 86_400_000);
  await prisma.$transaction(async tx => {
    await lockRootActor(tx, actorId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['client-invitation', email])}, 0))::text`;
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new OperationError('conflict', 'This email already has an account. Use workspace team invitations instead.');
    await tx.$executeRaw`DELETE FROM client_invitations WHERE email = ${email} AND "acceptedAt" IS NULL`;
    const inserted = await tx.$executeRaw`INSERT INTO client_invitations (id, email, "tokenHash", "workspaceName", "invitedById", "expiresAt", "createdAt") VALUES (${id}, ${email}, ${tokenHash}, ${workspaceName}, ${actorId}, ${expiresAt}, NOW())`;
    if (inserted !== 1) throw new OperationError('unavailable', 'The invitation could not be created.');
    await audit(tx, actorId, 'client.invited', id);
  }, { timeout: config.transactionTimeoutMs, maxWait: config.transactionMaxWaitMs });
  const url = new URL(config.registrationPath, origin);
  url.hash = new URLSearchParams({ client: token }).toString();
  let delivery: 'sent' | 'failed' | 'unavailable' | 'uncertain';
  try {
    delivery = (await sendTransactionalMail({ to: email, subject: copy.mailSubject, text: copy.mailBody.replace('{expiresAt}', expiresAt.toISOString()).replace('{url}', url.href), template: 'client.invitation' })).status;
  } catch { delivery = 'uncertain'; }
  // The committed invitation remains valid even if mail/audit transport fails afterwards.
  await prisma.$transaction(tx => audit(tx, actorId, 'client.invitation_delivery', id, delivery)).catch(() => undefined);
  return { created: true as const, id, url: url.href, expiresAt: expiresAt.toISOString(), delivery };
}

export async function revokeClientInvitation(actorId: string, input: unknown) {
  await assertRootActor(prisma, actorId);
  const config = await policy();
  const parsed = z.object({ id: z.string().min(1).max(config.idMaxLength), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== clientRevokeConfirmation(parsed.data.id)) throw invalid();
  const { id } = parsed.data;
  return prisma.$transaction(async tx => {
    await lockRootActor(tx, actorId);
    const rows = await tx.$queryRaw<Array<{ id: string; acceptedAt: Date | null }>>`SELECT id, "acceptedAt" FROM client_invitations WHERE id = ${id} FOR UPDATE`;
    if (!rows[0]) throw new OperationError('not_found', 'Client invitation not found.');
    if (rows[0].acceptedAt) throw new OperationError('conflict', 'This invitation has already been accepted.');
    const count = await tx.$executeRaw`DELETE FROM client_invitations WHERE id = ${id} AND "acceptedAt" IS NULL`;
    if (count !== 1) throw new OperationError('conflict', 'This invitation changed. Reload before trying again.');
    await audit(tx, actorId, 'client.invitationRevoked', id);
    return { revoked: true as const, id };
  }, { timeout: config.transactionTimeoutMs, maxWait: config.transactionMaxWaitMs });
}
