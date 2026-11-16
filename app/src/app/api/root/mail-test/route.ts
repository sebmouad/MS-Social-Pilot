import { currentRootActor } from '@/server/config/access';
import { sendTestMail } from '@/server/mail';
import { prisma } from '@/server/data';

export const runtime = 'nodejs';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Send a test email to the installation owner's own address (2026-11-16), and say what the mail service answered. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin && origin !== process.env.PUBLIC_ORIGIN) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  const actor = await currentRootActor();
  if (!actor?.isInstanceOwner) return reply({ error: 'Installation-owner access is required.', code: actor ? 'forbidden' : 'unauthorized' }, actor ? 403 : 401);
  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  if (body?.confirmation !== 'SEND TEST EMAIL') return reply({ error: 'Confirmation required. Repeat with confirmation exactly: SEND TEST EMAIL', code: 'invalid_request' }, 400);
  const result = await sendTestMail(actor.email);
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`mail_${crypto.randomUUID()}`}, ${actor.id}, 'mail.test_sent', ${JSON.stringify({ status: result.status })}::jsonb, NOW())`.catch(() => undefined);
  return reply({ to: actor.email.replace(/^(.).*(@.*)$/, '$1…$2'), ...result });
}
