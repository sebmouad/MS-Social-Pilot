/**
 * Clear an account's two-step sign-in from the server's shell — the only way
 * to reset root's own (root resets other people's from /root/users).
 *
 *   npx tsx scripts/admin/reset-two-step.ts someone@example.com
 *
 * Ends the account's sessions; it sets two-step up again at the next sign-in
 * if it is required.
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
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No account with the email ${email}.`);
      process.exit(1);
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null },
      }),
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.passkey.deleteMany({ where: { userId: user.id } }),
      prisma.trustedDevice.deleteMany({ where: { userId: user.id } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
      prisma.rootActivity.create({
        data: { actorId: null, action: 'user.twoStepReset', detail: { email: `${email} (server script)` } },
      }),
    ]);
    console.log(`Two-step sign-in cleared for ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
