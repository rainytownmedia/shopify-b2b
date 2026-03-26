import type { LoaderFunctionArgs } from "react-router";
import { data as dataResponse } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminAuth(request);
  const { id } = params;

  if (!id) {
    return dataResponse({ error: "Shop ID required" }, { status: 400 });
  }

  const logs = await prisma.activityLog.findMany({
    where: { shopId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return dataResponse({ data: logs });
}
