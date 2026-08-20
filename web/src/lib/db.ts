import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma 7 client. Note two things that changed from older tutorials:
 *  1. The client is imported from the GENERATED path, not '@prisma/client'.
 *  2. The connection is supplied by a driver adapter, not a schema `url`.
 *
 * The singleton prevents Next.js hot reload from opening a new pool per save.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
