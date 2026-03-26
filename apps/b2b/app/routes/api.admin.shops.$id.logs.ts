import { data as dataResponse } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminAuth(request);
  const shopId = params.id;

  if (!shopId) {
    return dataResponse({ error: "Shop ID is required" }, { status: 400 });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const skip = (page - 1) * limit;

  const logs = await db.activityLog.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: skip
  });

  const total = await db.activityLog.count({ where: { shopId } });

  return dataResponse({
    data: logs,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  });
}
