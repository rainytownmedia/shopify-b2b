import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rules = await prisma.checkoutRule.findMany();
  console.log("=== CheckoutRule Records ===");
  rules.forEach(r => {
    console.log(JSON.stringify({
      id: r.id,
      name: r.name,
      status: r.status,
      type: r.type,
      matchType: r.matchType,
      conditions: r.conditions,
      targetMethods: r.targetMethods,
    }, null, 2));
    console.log("---");
  });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
