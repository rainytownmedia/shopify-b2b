
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- DATABASE DIAGNOSTICS ---');
  
  try {
    // 1. List all tables
    const tables: any[] = await prisma.$queryRawUnsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    console.log('All Tables in Database:', tables.map(t => t.table_name));

    // 2. For each shop-related table, list columns
    const shopTables = tables.filter(t => t.table_name.toLowerCase() === 'shop');
    for (const table of shopTables) {
      console.log(`\nChecking columns for table: "${table.table_name}"`);
      const columns: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = '${table.table_name}';
      `);
      console.log(`Columns in "${table.table_name}":`, columns.map(c => c.column_name));
    }

  } catch (error) {
    console.error('❌ Error during diagnostics:', error);
  }
}

main().finally(() => prisma.$disconnect());
