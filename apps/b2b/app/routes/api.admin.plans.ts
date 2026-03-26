import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data as dataResponse } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminAuth(request);

  const plans = await prisma.appPlan.findMany({
    orderBy: { price: "asc" },
  });

  return dataResponse({ data: plans });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdminAuth(request);
  const body = await request.json();

  if (request.method === "POST") {
    const { name, description, price, features, interval, isActive } = body;

    const existing = await prisma.appPlan.findUnique({ where: { name } });
    if (existing) {
      return dataResponse({ error: "Plan name must be unique" }, { status: 400 });
    }

    const plan = await prisma.appPlan.create({
      data: {
        name,
        description,
        price: parseFloat(price) || 0,
        features: typeof features === "string" ? features : JSON.stringify(features || []),
        interval: interval || "EVERY_30_DAYS",
        isActive: isActive !== false,
      }
    });

    return dataResponse({ success: true, plan });
  }

  if (request.method === "PATCH") {
    const { id, name, description, price, features, interval, isActive } = body;

    const plan = await prisma.appPlan.update({
      where: { id },
      data: {
        name,
        description,
        price: price !== undefined ? parseFloat(price) : undefined,
        features: features !== undefined ? (typeof features === "string" ? features : JSON.stringify(features)) : undefined,
        interval,
        isActive,
      }
    });

    return dataResponse({ success: true, plan });
  }

  if (request.method === "DELETE") {
    const { id } = body;
    await prisma.appPlan.delete({ where: { id } });
    return dataResponse({ success: true });
  }

  return dataResponse({ error: "Method not allowed" }, { status: 405 });
}
