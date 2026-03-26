import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminAuth(request);

  // 1. Total active merchants
  const totalMerchants = await prisma.shop.count({
    where: { isActive: true }
  });

  // 2. Merchants by plan
  const merchantsByPlan = await prisma.shop.groupBy({
    by: ['plan'],
    _count: { _all: true },
    where: { isActive: true }
  });

  // 3. Simple revenue estimation (Sum of prices of plans for all active merchants)
  // This is a simplified calculation for the dashboard
  const activeShopsWithPlans = await prisma.shop.findMany({
    where: { isActive: true },
    select: { plan: true }
  });

  const allPlans = await prisma.appPlan.findMany();
  const planPriceMap = allPlans.reduce((acc, p) => ({ ...acc, [p.name]: p.price }), {} as any);
  planPriceMap["Free"] = 0;

  const totalMonthlyRevenue = activeShopsWithPlans.reduce((sum, shop) => {
    return sum + (planPriceMap[shop.plan] || 0);
  }, 0);

  // 4. Activity Logs (latest 5)
  const recentActivity = await prisma.activityLog.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
        id: true,
        action: true,
        method: true,
        path: true,
        createdAt: true,
        shopId: true
    }
  });

  const plans = await prisma.appPlan.findMany({
    where: { isActive: true },
    select: { name: true, price: true }
  });

  return data({
    data: {
      stats: {
        totalMerchants,
        totalMonthlyRevenue,
        planDistribution: merchantsByPlan.map(g => ({
          name: g.plan,
          count: g._count._all
        })),
        plans
      },
      recentActivity
    }
  });
}
