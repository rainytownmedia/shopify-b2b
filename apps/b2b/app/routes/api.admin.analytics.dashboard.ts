import type { LoaderFunctionArgs } from "react-router";
import { data as dataResponse } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminAuth(request);

  const totalShops = await prisma.shop.count();
  const activeShops = await prisma.shop.count({ where: { isActive: true } });
  const b2bEnabledShops = await prisma.shop.count({ where: { b2bEnabled: true } });

  const tickets = await prisma.supportTicket.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  const openTickets = tickets.find(t => t.status === 'open')?._count.id || 0;

  const recentInstalls = await prisma.shop.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { domain: true, email: true, plan: true }
  });

  return dataResponse({
    data: {
      total: totalShops,
      active: activeShops,
      inactive: totalShops - activeShops,
      b2bEnabled: b2bEnabledShops,
      openTickets,
      recentInstalls
    }
  });
}
