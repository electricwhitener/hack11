import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Next.js keeps secrets in .env.local; the Prisma CLI does not know that.
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

// Prisma 7 moved the connection URL out of schema.prisma into this file.
// The placeholder keeps `prisma generate` working before you have a database,
// so the project always compiles. Real commands (db push) need a real URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/placeholder',
  },
});
