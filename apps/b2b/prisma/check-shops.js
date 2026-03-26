import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const shopCount = await prisma.shop.count();
  console.log(`Total shops in DB: ${shopCount}`);
  
  if (shopCount > 0) {
    const shops = await prisma.shop.findMany({ take: 5 });
    console.log("Recent shops:", JSON.stringify(shops, null, 2));
  } else {
    console.log("No shops found in database.");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
