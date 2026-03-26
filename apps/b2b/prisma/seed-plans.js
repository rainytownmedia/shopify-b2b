import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const plans = [
    {
      name: "Free",
      description: "Everything you need to launch a B2B wholesale portal.",
      price: 0.0,
      interval: "EVERY_30_DAYS",
      isActive: true,
      features: JSON.stringify([
        "Up to 5 GB storage (1,000 rules limit)",
        "Customer Registration Form",
        "Wholesale Offers",
        "Tier Pricing"
      ])
    },
    {
      name: "Pro",
      description: "Double the storage for growing B2B businesses.",
      price: 20.0,
      interval: "EVERY_30_DAYS",
      isActive: true,
      features: JSON.stringify([
        "Up to 10 GB storage (2,000 rules limit)",
        "All Free Plan features",
        "Priority Support"
      ])
    },
    {
      name: "Unlimited",
      description: "Infinite scaling for enterprise merchants with massive catalogs.",
      price: 50.0,
      interval: "EVERY_30_DAYS",
      isActive: true,
      features: JSON.stringify([
        "Unlimited storage (Unlimited rules)",
        "All Pro Plan features",
        "Premium SLA Support",
        "Custom Setup Assistance"
      ])
    }
  ];

  for (const plan of plans) {
    await prisma.appPlan.upsert({
      where: { name: plan.name },
      update: plan,
      create: plan,
    });
  }

  console.log("Seeding finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
