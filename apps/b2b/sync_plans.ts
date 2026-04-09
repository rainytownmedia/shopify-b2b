
import { PrismaClient } from '@prisma/client';
import { PLANS } from './app/config/plans.config';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Syncing Plans from Config to Database ---');

  for (const key in PLANS) {
    const plan = PLANS[key];
    console.log(`Processing plan: ${plan.name}...`);

    await prisma.appPlan.upsert({
      where: { name: plan.name },
      update: {
        description: plan.description,
        price: plan.price,
        features: JSON.stringify(plan.features),
        isActive: true
      },
      create: {
        name: plan.name,
        description: plan.description,
        price: plan.price,
        currency: "USD",
        interval: "EVERY_30_DAYS",
        features: JSON.stringify(plan.features),
        isActive: true
      }
    });

    // 2. Sync existing shops to updated limits
    const updateResult = await prisma.shop.updateMany({
      where: { plan: plan.name },
      data: {
        maxRowLimit: plan.maxRowLimit,
        displayGbLimit: plan.displayGbLimit
      }
    });
    console.log(`   - Synced ${updateResult.count} shops for plan: ${plan.name}`);
  }

  console.log('✅ Sync complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error syncing plans:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
