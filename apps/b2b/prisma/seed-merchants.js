import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const merchants = [
    {
      id: "rainytown-test-store.myshopify.com",
      domain: "rainytown-test-store.myshopify.com",
      name: "Rainytown Test Store",
      email: "owner@rainytown.com",
      plan: "Pro",
      status: "ACTIVE",
      subscriptionStatus: "ACTIVE",
      isActive: true,
      maxRowLimit: 2000,
      displayGbLimit: 10.0,
      installedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    },
    {
      id: "wholesale-demo-shop.myshopify.com",
      domain: "wholesale-demo-shop.myshopify.com",
      name: "Wholesale Demo Shop",
      email: "demo@example.com",
      plan: "Unlimited",
      status: "TRIAL",
      subscriptionStatus: "TRIALING",
      isActive: true,
      maxRowLimit: 5000,
      displayGbLimit: 25.0,
      installedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    },
    {
      id: "suspended-account.myshopify.com",
      domain: "suspended-account.myshopify.com",
      name: "Inactive Merchant",
      email: "bad@merchant.com",
      plan: "Free",
      status: "SUSPENDED",
      subscriptionStatus: "CANCELED",
      isActive: true,
      maxRowLimit: 1000,
      displayGbLimit: 5.0,
      installedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 100 days ago
    }
  ];

  console.log("Seeding merchants...");
  
  for (const merchant of merchants) {
    await prisma.shop.upsert({
      where: { id: merchant.id },
      update: merchant,
      create: merchant,
    });
  }

  console.log("Seeding finished successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
