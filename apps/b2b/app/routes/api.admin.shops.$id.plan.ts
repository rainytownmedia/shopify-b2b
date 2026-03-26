import type { ActionFunctionArgs } from "react-router";
import { data as dataResponse } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const admin = await requireAdminAuth(request);
  const { id } = params;

  if (request.method !== "POST") {
    return dataResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const { planName } = await request.json();

  if (!planName) {
    return dataResponse({ error: "Plan name required" }, { status: 400 });
  }

  const shop = await prisma.shop.update({
    where: { id },
    data: { plan: planName }
  });

  await prisma.auditLog.create({
    data: {
      adminId: admin.id,
      action: "override_shop_plan",
      resource: `shop:${id}`,
      details: JSON.stringify({ newPlan: planName })
    }
  });

  return dataResponse({ success: true, shop });
}
