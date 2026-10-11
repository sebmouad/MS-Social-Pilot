/**
 * Make an account root, from the server's shell — the recovery path when root
 * is lost (the person left, the password and the mailbox are gone). There is
 * deliberately no way to do this from the web.
 *
 *   npx tsx scripts/admin/set-root.ts someone@example.com
 *
 * Runs with the app's DATABASE_URL. Whoever was root before stops being root;
 * the change is written to the root activity log.
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
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No account with the email ${email}.`);
      process.exit(1);
    }
    const previous = await prisma.user.findMany({ where: { isInstanceOwner: true }, select: { email: true } });
    await prisma.$transaction([
      prisma.user.updateMany({ where: { isInstanceOwner: true }, data: { isInstanceOwner: false } }),
      prisma.user.update({ where: { id: user.id }, data: { isInstanceOwner: true, disabledAt: null } }),
      prisma.rootActivity.create({
        data: {
          actorId: null,
          action: 'root.transferred',
          detail: { from: previous.map((entry) => entry.email).join(', ') || 'nobody', to: `${email} (server script)` },
        },
      }),
    ]);
    console.log(`${email} is root now.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
