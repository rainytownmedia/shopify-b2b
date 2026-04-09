
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- FORCING ADD COLUMN "host" ---');
  
  const queries = [
    'ALTER TABLE "shop" ADD COLUMN host text;',
    'ALTER TABLE "Shop" ADD COLUMN host text;',
    'ALTER TABLE shop ADD COLUMN host text;'
  ];

  for (const sql of queries) {
    try {
      console.log(`Trying SQL: ${sql}`);
      await prisma.$executeRawUnsafe(sql);
      console.log('✅ Success executing query!');
      break; 
    } catch (error: any) {
      console.log(`❌ Failed: ${error.message}`);
    }
  }

  console.log('\n--- Final Column Check ---');
  try {
    const res: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'shop' OR table_name = 'Shop';
    `);
    console.log('Current columns in DB:', res.map(r => r.column_name));
    
    if (res.some(r => r.column_name === 'host')) {
      console.log('🎉 THE "host" COLUMN IS FINALLY HERE!');
    } else {
      console.log('💀 Still not there. Possible permission issue or wrong table name.');
    }
  } catch (e) {
    console.error('Error checking columns:', e);
  }
}

main().finally(() => prisma.$disconnect());
