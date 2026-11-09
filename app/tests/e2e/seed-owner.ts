// Local end-to-end runs only: an instance owner with a workspace, as an open sign-up plus email confirmation would leave
// them. Refuses to run unless DATABASE_URL points at 127.0.0.1/localhost.
//   node --import tsx tests/e2e/seed-owner.ts <email> <password>
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { hashStoredPassword } from '@/server/auth';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')) throw new Error('Local database only.');
  if (!email || !password) throw new Error('usage: seed-owner.ts <email> <password>');
  const existing = await prisma.user.findUnique({ where: { email } });
  const userId = existing?.id ?? randomUUID();
  if (!existing) await prisma.user.create({ data: { id: userId, email, name: 'Test Owner', passwordHash: hashStoredPassword(password), isInstanceOwner: true } });
  await prisma.$executeRaw`UPDATE users SET "emailVerifiedAt" = NOW(), "isInstanceOwner" = true WHERE id = ${userId}`;
  if (!(await prisma.membership.count({ where: { userId } }))) {
    const workspaceId = randomUUID();
    await prisma.workspace.create({ data: { id: workspaceId, name: 'Test Kitchen', slug: `test-kitchen-${workspaceId}`, timezone: 'Europe/Paris', memberships: { create: { id: randomUUID(), userId, role: 'owner' } } } });
    await prisma.$executeRaw`UPDATE users SET "lastActiveWorkspaceId" = ${workspaceId} WHERE id = ${userId}`;
  }
  console.log('owner ready', email);
  await prisma.$disconnect();
}
void main();
