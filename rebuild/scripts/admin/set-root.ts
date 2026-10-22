/**
 * Make an account the installation owner (Root) from the server's shell: the
 * recovery path when Root is lost. There is deliberately no web path for this.
 *
 *   cd rebuild && npx tsx scripts/admin/set-root.ts someone@example.com
 *
 * Runs with the app's DATABASE_URL. Whoever was Root before stops being Root,
 * the target account is re-enabled, and the change is written to the Root
 * activity log (`root_activities`).
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npx tsx scripts/admin/set-root.ts <email>');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.error(`No account with the email ${email}.`);
      process.exit(1);
    }
    const previous = await prisma.user.findMany({ where: { isInstanceOwner: true }, select: { email: true } });
    const detail = JSON.stringify({ from: previous.map(entry => entry.email).join(', ') || 'nobody', to: `${email} (server script)` });
    await prisma.$transaction([
      prisma.user.updateMany({ where: { isInstanceOwner: true }, data: { isInstanceOwner: false } }),
      prisma.user.update({ where: { id: user.id }, data: { isInstanceOwner: true, disabledAt: null } }),
      prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (gen_random_uuid()::text, NULL, 'root.transferred', ${detail}::jsonb, NOW())`,
    ]);
    console.log(`${email} is Root now.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
