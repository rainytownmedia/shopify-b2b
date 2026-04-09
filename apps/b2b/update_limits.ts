
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Update: Rule Limits ---');

  // 1. Update AppPlan "Free" features
  const freePlan = await prisma.appPlan.findUnique({ where: { name: 'Free' } });
  if (freePlan && freePlan.features) {
    let features = JSON.parse(freePlan.features);
    // Replace "1,000 rules" with "500 rules"
    features = features.map(f => f.replace('1,000 rules', '500 rules'));
    
    await prisma.appPlan.update({
      where: { name: 'Free' },
      data: { features: JSON.stringify(features) }
    });
    console.log('✅ Updated AppPlan "Free" features text.');
  }

  // 2. Update existing Shops on Free plan
  const result = await prisma.shop.updateMany({
    where: { plan: 'Free' },
    data: { maxRowLimit: 500 }
  });
  console.log(`✅ Updated ${result.count} existing shops on the Free plan to 500 rules.`);

  console.log('--- Update Complete ---');
}

main()
  .catch((e) => {
    console.error('❌ Error updating database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
