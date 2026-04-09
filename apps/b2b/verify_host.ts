
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Checking shop table columns ---');
  try {
    const columns = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'shop';
    `);
    console.log('Columns found in Database:', columns);
    
    const hasHost = (columns as any[]).some(c => c.column_name === 'host');
    if (hasHost) {
      console.log('✅ Success: The "host" column EXISTS in the database.');
    } else {
      console.log('❌ Failure: The "host" column does NOT exist in the database.');
    }
  } catch (error) {
    console.error('❌ Error querying database:', error);
  }
}

main().finally(() => prisma.$disconnect());
