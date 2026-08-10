import { PrismaClient } from '@prisma/client';

/**
 * A single PrismaClient per process. Next's dev server re-evaluates modules on
 * every edit, so the instance is cached on globalThis to avoid exhausting
 * database connections.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
