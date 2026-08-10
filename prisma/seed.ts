/**
 * Development seed.
 *
 * Creates a workspace with a default posting queue and a demo user so the app
 * is usable immediately after `npm run db:push`. No Facebook data is faked:
 * connecting a real account is the only way to get real destinations, and a
 * fake one would fail confusingly at publish time.
 *
 * Run with: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/lib/crypto';
import { DEFAULT_QUEUE_SLOTS } from '../src/lib/time';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'change-me-please';

async function main(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log(`Seed user ${DEMO_EMAIL} already exists; nothing to do.`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: 'Demo User',
      passwordHash: hashPassword(DEMO_PASSWORD),
      memberships: {
        create: {
          role: 'owner',
          workspace: { create: { name: 'Demo Workspace', timezone: 'Europe/Paris' } },
        },
      },
    },
    include: { memberships: true },
  });

  const workspaceId = user.memberships[0]!.workspaceId;

  await prisma.queueSlot.createMany({
    data: DEFAULT_QUEUE_SLOTS.map((slot) => ({ ...slot, workspaceId })),
  });

  console.log('Seeded demo workspace.');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log('Connect a Facebook account from the Accounts page to add destinations.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
