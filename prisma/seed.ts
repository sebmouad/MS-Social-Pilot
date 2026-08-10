/**
 * Development seed.
 *
 * Creates a demo user with two workspaces, so the client switcher and the
 * cross-workspace behaviour are exercisable straight away. No Facebook data is
 * faked: connecting a real account is the only way to get real destinations,
 * and a fake one would fail confusingly at publish time.
 *
 * Run with: npm run db:seed
 */

import { PrismaClient, WorkspaceRole } from '@prisma/client';

import { hashPassword } from '../src/lib/crypto';
import { DEFAULT_QUEUE_SLOTS } from '../src/lib/time';
import { slugify } from '../src/lib/slug';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'change-me-please';

async function createWorkspace(options: {
  name: string;
  ownerId: string;
  timezone: string;
  requiresApproval?: boolean;
}): Promise<string> {
  const workspace = await prisma.workspace.create({
    data: {
      name: options.name,
      slug: slugify(options.name),
      timezone: options.timezone,
      requiresApproval: options.requiresApproval ?? false,
      memberships: { create: { userId: options.ownerId, role: WorkspaceRole.owner } },
      queueSlots: { create: DEFAULT_QUEUE_SLOTS },
      notificationSettings: { create: { userId: options.ownerId } },
    },
  });
  return workspace.id;
}

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
    },
  });

  const primary = await createWorkspace({
    name: 'Demo Workspace',
    ownerId: user.id,
    timezone: 'Europe/Paris',
  });

  // A second client, with approval turned on, so both workflows are visible.
  await createWorkspace({
    name: 'Second Client',
    ownerId: user.id,
    timezone: 'Europe/London',
    requiresApproval: true,
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastActiveWorkspaceId: primary } });

  console.log('Seeded demo account with two workspaces.');
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
