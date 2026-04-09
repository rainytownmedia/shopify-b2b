
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Adding "host" column via Raw SQL ---');
  try {
    // PostgreSQL direct SQL
    await prisma.$executeRawUnsafe(`ALTER TABLE "shop" ADD COLUMN IF NOT EXISTS "host" TEXT;`);
    console.log('✅ Column "host" added successfully (or already existed).');
  } catch (error) {
    console.error('❌ Failed to add column via SQL:', error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
