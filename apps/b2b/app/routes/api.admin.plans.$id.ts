import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data as dataResponse } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminAuth(request);
  const { id } = params;
  if (!id) return dataResponse({ error: "Missing ID" }, { status: 400 });

  const plan = await prisma.appPlan.findUnique({ where: { id } });
  if (!plan) return dataResponse({ error: "Not found" }, { status: 404 });

  return dataResponse({ data: plan });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdminAuth(request);
  const { id } = params;
  if (!id) return dataResponse({ error: "Missing ID" }, { status: 400 });

  const { method } = request;

  if (method === "PUT" || method === "PATCH") {
    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.price !== undefined) updateData.price = parseFloat(body.price);
    if (body.features !== undefined) {
      updateData.features = typeof body.features === "string" ? body.features : JSON.stringify(body.features);
    }
    if (body.interval !== undefined) updateData.interval = body.interval;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const plan = await prisma.appPlan.update({ where: { id }, data: updateData });
    return dataResponse({ success: true, plan });
  }

  if (method === "DELETE") {
    await prisma.appPlan.delete({ where: { id } });
    return dataResponse({ success: true, message: "Plan deleted" });
  }

  return dataResponse({ error: "Method not allowed" }, { status: 405 });
}
