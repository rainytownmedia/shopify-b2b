import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.adminUser.upsert({
    where: { email: "admin@yourapp.com" },
    update: {},
    create: {
      email: "admin@yourapp.com",
      password: "Admin@123456",
      name: "Super Admin",
      role: "SUPER_ADMIN",
      isActive: true,
    },
  });
  console.log("✅ Admin user created:", admin.email);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
