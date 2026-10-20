import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { assertAgencyOverviewCredentialAccess } from '@/modules/agency/server/access';
import { personKeyCreateConfirmation, personKeyRevokeConfirmation, type PersonMcpIdentity } from './types';

type Actor = { userId: string };
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const denied = () => new OperationError('forbidden', 'Person MCP access is unavailable.');
const invalid = () => new OperationError('invalid_request', 'Choose valid person key details and the exact confirmation.');
const unavailable = () => new OperationError('unavailable', 'Person key settings are unavailable.');
export async function personKeyPolicy() {
  const keys = ['mcp.personKeys.maxActivePerPerson', 'mcp.personKeys.maxLifetimeDays', 'mcp.personKeys.nameMaxLength', 'mcp.keys.transactionTimeoutMs', 'mcp.keys.transactionMaxWaitMs'] as const;
  const result = z.tuple([z.number().int().min(1).max(1000), z.number().int().min(1).max(3650), z.number().int().min(1).max(200), z.number().int().min(1000).max(300000), z.number().int().min(100).max(30000)]).safeParse(await Promise.all(keys.map(key => runtimeConfig(key))));
  if (!result.success) throw unavailable();
  const [maxActive, maxLifetimeDays, nameMaxLength, timeout, maxWait] = result.data;
  return { maxActive, maxLifetimeDays, nameMaxLength, timeout, maxWait };
}
async function enabled() { return await runtimeConfig('mcp.enabled') === true && await runtimeConfig('mcp.personKeys.enabled') === true; }
async function person(actor: Actor) {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { id: true, disabledAt: true } });
  if (!user || user.disabledAt) throw denied();
}
async function lockedPerson(tx: Tx, actor: Actor) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id=${actor.userId} AND "disabledAt" IS NULL FOR SHARE`;
  if (!rows.length) throw denied();
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`person-mcp:${actor.userId}`}))::text`;
}
async function audit(tx: Tx, actor: Actor, action: string, keyId: string) {
  const changed = await tx.$executeRaw`INSERT INTO root_activities (id,"actorId",action,detail,"createdAt") VALUES (${`personkey_audit_${randomBytes(12).toString('hex')}`},${actor.userId},${action},${JSON.stringify({ keyId, scope: 'person', readFeature: 'agency/overview' })}::jsonb,NOW())`;
  if (changed !== 1) throw unavailable();
}
export async function issuePersonKey(actor: Actor, input: unknown) {
  const parsed = z.object({ name: z.string().trim().min(1), expiresInDays: z.number().int().positive(), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success) throw invalid();
  const data = parsed.data;
  if (data.confirmation !== personKeyCreateConfirmation(data.name, data.expiresInDays)) throw invalid();
  await person(actor);
  const policy = await personKeyPolicy();
  if (data.name.length > policy.nameMaxLength || data.expiresInDays > policy.maxLifetimeDays) throw invalid();
  if (!await enabled()) throw denied();
  await assertAgencyOverviewCredentialAccess(actor);
  const id = `personkey_${randomBytes(12).toString('hex')}`;
  const token = `mcp_person_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + data.expiresInDays * 86400000);
  const tokenPrefix = token.slice(0, 18);
  await prisma.$transaction(async tx => {
    await lockedPerson(tx, actor);
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM person_mcp_keys WHERE "userId"=${actor.userId} AND "revokedAt" IS NULL AND "expiresAt">NOW()`;
    if (!rows[0]) throw unavailable();
    if (Number(rows[0].count) >= policy.maxActive) throw new OperationError('conflict', 'Your active person key limit has been reached.');
    const changed = await tx.$executeRaw`INSERT INTO person_mcp_keys (id,"userId",name,"tokenHash","tokenPrefix","readFeature","expiresAt") VALUES (${id},${actor.userId},${data.name},${tokenHash},${tokenPrefix},'agency/overview',${expiresAt})`;
    if (changed !== 1) throw unavailable();
    await audit(tx, actor, 'mcp.person_key_created', id);
  }, { timeout: policy.timeout, maxWait: policy.maxWait });
  return { key: { id, name: data.name, tokenPrefix, expiresAt: expiresAt.toISOString() }, token };
}
export async function listPersonKeys(actor: Actor) {
  await person(actor);
  const policy = await personKeyPolicy();
  const keys = await prisma.$queryRaw<Array<{ id: string; name: string; tokenPrefix: string; expiresAt: Date; createdAt: Date }>>`SELECT id,name,"tokenPrefix","expiresAt","createdAt" FROM person_mcp_keys WHERE "userId"=${actor.userId} AND "revokedAt" IS NULL AND "expiresAt">NOW() ORDER BY "createdAt" DESC,id LIMIT ${policy.maxActive + 1}`;
  return { keys: keys.slice(0, policy.maxActive), truncated: keys.length > policy.maxActive, policy: { maxLifetimeDays: policy.maxLifetimeDays, nameMaxLength: policy.nameMaxLength } };
}
export async function revokePersonKey(actor: Actor, input: unknown) {
  const parsed = z.object({ id: z.string().min(1).max(100), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== personKeyRevokeConfirmation(parsed.data.id)) throw invalid();
  await person(actor);
  const policy = await personKeyPolicy();
  return prisma.$transaction(async tx => {
    await lockedPerson(tx, actor);
    const changed = await tx.$executeRaw`UPDATE person_mcp_keys SET "revokedAt"=NOW() WHERE id=${parsed.data.id} AND "userId"=${actor.userId} AND "revokedAt" IS NULL`;
    if (changed !== 1) throw new OperationError('not_found', 'Active person key not found.');
    await audit(tx, actor, 'mcp.person_key_revoked', parsed.data.id);
    return { revoked: true };
  }, { timeout: policy.timeout, maxWait: policy.maxWait });
}
type CredentialRow = { id: string; userId: string; readFeature: string; disabledAt: Date | null };
const valid = (row: CredentialRow | undefined) => row && !row.disabledAt && row.readFeature === 'agency/overview';
export async function authenticatePersonBearer(header: string | null): Promise<PersonMcpIdentity | null> {
  const match = header?.match(/^Bearer\s+(mcp_person_[A-Za-z0-9_-]{43})$/);
  if (!match || !await enabled()) return null;
  const hash = createHash('sha256').update(match[1]).digest('hex');
  const rows = await prisma.$queryRaw<CredentialRow[]>`SELECT k.id,k."userId",k."readFeature",u."disabledAt" FROM person_mcp_keys k JOIN users u ON u.id=k."userId" WHERE k."tokenHash"=${hash} AND k."revokedAt" IS NULL AND k."expiresAt">NOW() AND u."disabledAt" IS NULL LIMIT 1`;
  const key = rows[0];
  return valid(key) ? { scope: 'person', userId: key.userId, personKeyId: key.id, readFeature: 'agency/overview' } : null;
}
/** Revalidates an already authenticated identity on every host invocation; no cached grants. */
export async function assertPersonCredential(identity: PersonMcpIdentity) {
  if (identity.scope !== 'person' || identity.readFeature !== 'agency/overview' || !identity.personKeyId || ['apiKeyId', 'workspaceId', 'workspace', 'permissions', 'isInstanceOwner'].some(key => key in identity) || !await enabled()) throw denied();
  const rows = await prisma.$queryRaw<CredentialRow[]>`SELECT k.id,k."userId",k."readFeature",u."disabledAt" FROM person_mcp_keys k JOIN users u ON u.id=k."userId" WHERE k.id=${identity.personKeyId} AND k."userId"=${identity.userId} AND k."revokedAt" IS NULL AND k."expiresAt">NOW() AND u."disabledAt" IS NULL LIMIT 1`;
  if (!valid(rows[0])) throw denied();
}
