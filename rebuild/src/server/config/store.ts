import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CONFIG_BY_KEY, CONFIG_REGISTRY, type ConfigKey } from '@/lib/config/registry';
import { prisma } from '@/server/data';
import { Prisma } from '../../../generated/client';

const secretKey = () => {
  const encoded = process.env.ENCRYPTION_KEY;
  if (!encoded) throw new Error('ENCRYPTION_KEY is required before saving secret configuration.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes.');
  return key;
};

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
}

function decrypt(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Malformed encrypted configuration.');
  const [, iv, tag, body] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

export async function readConfig() {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: CONFIG_REGISTRY.map((item) => item.key) } }, select: { key: true, value: true, encrypted: true } });
  const stored = new Map(rows.map((row) => [row.key, row]));
  return CONFIG_REGISTRY.map((item) => {
    const row = stored.get(item.key);
    if (item.kind === 'secret') return { key: item.key, value: '', isSet: Boolean(row), source: row ? 'database' as const : 'default' as const };
    if (!row) return { key: item.key, value: item.defaultValue, isSet: false, source: 'default' as const };
    const raw = row.value as unknown;
    const parsed = item.schema.safeParse(raw);
    return { key: item.key, value: parsed.success ? parsed.data : item.defaultValue, isSet: parsed.success, source: parsed.success ? 'database' as const : 'default' as const };
  });
}

const writeSchema = z.object({ key: z.string(), value: z.unknown(), clear: z.boolean().optional() });
export async function saveConfig(input: unknown, actorId: string) {
  const requestResult = writeSchema.safeParse(input);
  if (!requestResult.success) throw new Error('Invalid value: expected a key and value.');
  const request = requestResult.data;
  const definition = CONFIG_BY_KEY.get(request.key as ConfigKey);
  if (!definition) throw new Error('Unknown configuration key.');
  if (definition.kind === 'secret' && request.clear) {
    await prisma.$transaction(async (tx) => {
      await tx.appSetting.deleteMany({ where: { key: definition.key } });
      await audit(tx, actorId, definition.key, 'cleared');
    });
    return;
  }
  const checked = definition.schema.safeParse(request.value);
  if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? 'Invalid value.');
  if (definition.kind === 'secret' && checked.data === '') throw new Error('Enter a secret or use Clear saved secret.');
  const encrypted = definition.kind === 'secret';
  const value = encrypted ? encrypt(String(checked.data)) : checked.data;
  await prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({
      where: { key: definition.key },
      create: { key: definition.key, value, encrypted, updatedAt: new Date() },
      update: { value, encrypted, updatedAt: new Date() },
    });
    await audit(tx, actorId, definition.key, encrypted ? 'secret updated' : 'value updated');
  });
}

async function audit(tx: Prisma.TransactionClient, actorId: string, key: string, change: string) {
  // Existing installation-wide audit table from the legacy schema. Parameterized
  // values keep the query safe; the secret itself is never included in detail.
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`cfg_${randomBytes(12).toString('hex')}`}, ${actorId}, 'config.changed', ${JSON.stringify({ key, change })}::jsonb, NOW())`;
}
