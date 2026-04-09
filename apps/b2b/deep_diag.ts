
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- DEEP DATABASE DIAGNOSTICS ---');
  
  try {
    // 1. Find the exact schema and name of the table
    const tableInfo: any[] = await prisma.$queryRawUnsafe(`
      SELECT table_schema, table_name, table_type 
      FROM information_schema.tables 
      WHERE table_name ILIKE '%shop%';
    `);
    console.log('Table Search Results:', tableInfo);

    // 2. Try to add the column specifying the schema (usually public)
    if (tableInfo.length > 0) {
        const schema = tableInfo[0].table_schema;
        const name = tableInfo[0].table_name;
        console.log(`\nAttempting to alter table: ${schema}.${name}`);
        
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE "${schema}"."${name}" ADD COLUMN IF NOT EXISTS host text;`);
            console.log('✅ Final attempt SUCCESS!');
        } catch (err: any) {
            console.error('❌ Final attempt FAILED:', err.message);
        }
    }

  } catch (error) {
    console.error('Error during deep diagnostics:', error);
  }
}

main().finally(() => prisma.$disconnect());
