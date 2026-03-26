import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminAuth(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.max(1, parseInt(url.searchParams.get("limit") || "10"));
  const search = url.searchParams.get("search") || "";

  const where = search ? {
    OR: [
      { domain: { contains: search, mode: "insensitive" as const } },
      { name: { contains: search, mode: "insensitive" as const } },
      { email: { contains: search, mode: "insensitive" as const } },
    ]
  } : {};

  const [total, shops] = await Promise.all([
    prisma.shop.count({ where }),
    prisma.shop.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        domain: true,
        name: true,
        email: true,
        plan: true,
        status: true,
        subscriptionStatus: true,
        isActive: true,
        installedAt: true,
        updatedAt: true,
      }
    })
  ]);

  return data({
    data: shops,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  });
}
