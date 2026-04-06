import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkData() {
    console.log("Price Lists:");
    const lists = await prisma.priceList.findMany({ include: { items: true } });
    console.dir(lists, { depth: null });

    console.log("Shops:");
    const shops = await prisma.shop.findMany();
    console.dir(shops, { depth: null });

    console.log("Activity logs count:", await prisma.activityLog.count());
}

checkData()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
