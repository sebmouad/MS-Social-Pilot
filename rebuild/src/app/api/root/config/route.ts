import { NextResponse } from 'next/server';
import { safeConfigShape, AVAILABILITY_CATALOG, CONFIG_BY_KEY, CONFIG_SCHEMA_VERSION } from '@/lib/config/registry';
import { currentRootActor } from '@/server/config/access';
import { readConfig, saveConfig } from '@/server/config/store';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET() {
  try {
    const actor = await currentRootActor();
    if (!actor?.isInstanceOwner) return reply({ error: 'Not found.' }, actor ? 404 : 401);
    return reply({ schemaVersion: CONFIG_SCHEMA_VERSION, definitions: safeConfigShape(), values: await readConfig(), availability: AVAILABILITY_CATALOG });
  } catch {
    return reply({ error: 'Configuration could not be loaded.' }, 500);
  }
}

export async function PUT(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || !isSameOrigin(origin, request.url)) {
    return reply({ error: 'Cross-origin request denied.' }, 403);
  }
  const actor = await currentRootActor();
  if (!actor?.isInstanceOwner) return reply({ error: 'Not found.' }, actor ? 404 : 401);
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: 'Request body must be valid JSON.' }, 400); }
  const validationError = validateRegisteredValue(body);
  if (validationError) return reply({ error: validationError }, 400);
  try {
    await saveConfig(body, actor.id);
    return reply({ ok: true, schemaVersion: CONFIG_SCHEMA_VERSION, values: await readConfig() });
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unknown configuration key.' || error.message === 'Only secret values can be cleared.' || error.message.startsWith('Invalid value') || error.message.startsWith('Enter a secret'))) {
      return reply({ error: error.message }, 400);
    }
    return reply({ error: 'Configuration could not be saved.' }, 500);
  }
}

/** Validate against the registry before persistence so schema errors stay client-actionable. */
function validateRegisteredValue(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (typeof input.key !== 'string') return null;
  const definition = CONFIG_BY_KEY.get(input.key);
  if (!definition) return null;
  if (input.clear && definition.kind !== 'secret') return null;
  if (input.clear === true && definition.kind === 'secret') return null;
  const result = definition.schema.safeParse(input.value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue?.message ?? 'Invalid value.'}`;
  }
  return null;
}

function isSameOrigin(origin: string, requestUrl: string): boolean {
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
