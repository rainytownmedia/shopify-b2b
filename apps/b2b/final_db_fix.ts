
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- FINAL ATTEMPT: Adding "host" to "shop" ---');
  
  try {
    // Try without quotes first, then with quotes
    const sqlCommands = [
      'ALTER TABLE shop ADD COLUMN host text;',
      'ALTER TABLE "shop" ADD COLUMN host text;'
    ];

    for (const sql of sqlCommands) {
      try {
        console.log(`Executing: ${sql}`);
        await prisma.$executeRawUnsafe(sql);
        console.log('✅ Query executed successfully!');
        break;
      } catch (err: any) {
        console.log(`❌ Failed: ${err.message}`);
      }
    }

    // Final Verification
    console.log('\n--- Final Verification ---');
    const columns: any[] = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'shop';
    `);
    
    const columnNames = columns.map(c => c.column_name);
    console.log('Columns now in "shop":', columnNames);

    if (columnNames.includes('host')) {
      console.log('🎉 CONFIRMED: "host" column is now present!');
    } else {
      console.log('💀 CRITICAL: Still not found. Check permissions or schema.');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

main().finally(() => prisma.$disconnect());
