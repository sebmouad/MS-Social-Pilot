import { z } from 'zod';
import { createCipheriv, randomBytes } from 'node:crypto';
import { CONFIG_BY_KEY, CONFIG_SCHEMA_VERSION, safeConfigShape, AVAILABILITY_CATALOG, type ConfigKey } from '@/lib/config/registry';
import { prisma } from '@/server/data';
import type { Prisma } from '../../../../generated/client';
import { applySynchronousPolicy } from '@/server/synchronous-policy';
import { applyConnectionHealthCopy } from '@/lib/connection-health';
import { readConfig } from '@/server/config/store';
import { assertRootActor, lockRootActor, invalid } from '@/server/root/legacy/authz';
// Versioned AES-GCM envelope and random audit entropy, not operational limits.
const CONFIG_SECRET_KEY_BYTES = 32;
const CONFIG_SECRET_IV_BYTES = 12;
const CONFIG_AUDIT_ID_BYTES = 12;
const secretKey = () => {
  const encoded = process.env.ENCRYPTION_KEY;
  if (!encoded) throw new Error('ENCRYPTION_KEY is required before saving secret configuration.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== CONFIG_SECRET_KEY_BYTES) throw new Error('ENCRYPTION_KEY must decode to 32 bytes.');
  return key;
};

function encrypt(value: string): string {
  const iv = randomBytes(CONFIG_SECRET_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
}


/** One private snapshot shared by UI, REST and installation MCP. */
export async function readRootConfig(actorId: string) {
  await assertRootActor(prisma, actorId);
  return { schemaVersion: CONFIG_SCHEMA_VERSION, definitions: safeConfigShape(), values: await readConfig(), availability: AVAILABILITY_CATALOG };
}
const writeSchema = z.object({ key: z.string(), value: z.unknown().optional(), clear: z.boolean().optional(), confirmation: z.string().optional() }).strict();
export async function saveRootConfig(input: unknown, actorId: string) {
  await assertRootActor(prisma, actorId);
  const requestResult = writeSchema.safeParse(input);
  if (!requestResult.success) throw invalid('Invalid value: expected a key and value.');
  const request = requestResult.data;
  const definition = CONFIG_BY_KEY.get(request.key as ConfigKey);
  if (!definition) throw invalid('Unknown configuration key.');
  if (request.clear && definition.kind !== 'secret') throw invalid('Only secret values can be cleared.');
  const expected = `${request.clear ? 'CLEAR ROOT SECRET' : 'SET ROOT CONFIG'} ${request.key}`;
  if (request.confirmation !== expected) throw invalid(`Confirmation required. Repeat with confirmation exactly: ${expected}`);
  if (definition.kind === 'secret' && request.clear) {
    await prisma.$transaction(async (tx) => {
    await lockRootActor(tx, actorId);
      await tx.appSetting.deleteMany({ where: { key: definition.key } });
      await audit(tx, actorId, definition.key, 'cleared');
    });
    return;
  }
  const checked = definition.schema.safeParse(request.value);
  if (!checked.success) throw invalid(checked.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' '));
  if (definition.kind === 'secret' && checked.data === '') throw invalid('Enter a secret or use Clear saved secret.');
  const encrypted = definition.kind === 'secret';
  const value = encrypted ? encrypt(String(checked.data)) : checked.data;
  await prisma.$transaction(async (tx) => {
    await lockRootActor(tx, actorId);
    await tx.appSetting.upsert({
      where: { key: definition.key },
      create: { key: definition.key, value, encrypted, updatedAt: new Date() },
      update: { value, encrypted, updatedAt: new Date() },
    });
    await audit(tx, actorId, definition.key, encrypted ? 'secret updated' : 'value updated');
  });
  applySynchronousPolicy(definition.key, checked.data);
  if (definition.key === 'connections.healthCopy') applyConnectionHealthCopy(checked.data);
  if (definition.key === 'app.publicOrigin' || definition.key === 'app.developmentOrigins') await (await import('@/server/request-origin')).refreshPublicOrigin();
}

async function audit(tx: Prisma.TransactionClient, actorId: string, key: string, change: string) {
  // Existing installation-wide audit table from the legacy schema. Parameterized
  // values keep the query safe; the secret itself is never included in detail.
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`cfg_${randomBytes(CONFIG_AUDIT_ID_BYTES).toString('hex')}`}, ${actorId}, 'config.changed', ${JSON.stringify(configAuditDetail(key, change))}::jsonb, NOW())`;
}

/** Stable, value-free audit payload for validating Root setting changes. */
export function configAuditDetail(key: string, change: string) {
  return { key, change, schemaVersion: CONFIG_SCHEMA_VERSION };
}
