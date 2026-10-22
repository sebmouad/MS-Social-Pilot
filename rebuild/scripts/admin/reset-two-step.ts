/**
 * Clear an account's two-step sign-in from the server's shell: the only way to
 * reset Root's own (Root resets other people's from /root/users).
 *
 *   cd rebuild && npx tsx scripts/admin/reset-two-step.ts someone@example.com
 *
 * Ends the account's sessions; two-step is set up again at the next sign-in if
 * it is required. The change is written to the Root activity log.
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npx tsx scripts/admin/reset-two-step.ts <email>');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.error(`No account with the email ${email}.`);
      process.exit(1);
    }
    const detail = JSON.stringify({ email: `${email} (server script)` });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null } }),
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.passkey.deleteMany({ where: { userId: user.id } }),
      prisma.$executeRaw`DELETE FROM trusted_devices WHERE "userId" = ${user.id}`,
      prisma.session.deleteMany({ where: { userId: user.id } }),
      prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (gen_random_uuid()::text, NULL, 'user.twoStepReset', ${detail}::jsonb, NOW())`,
    ]);
    console.log(`Two-step sign-in cleared for ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
