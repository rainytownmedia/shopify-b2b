import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data as dataResponse } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminAuth(request);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "open";

  const tickets = await prisma.supportTicket.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return dataResponse({ data: tickets });
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdminAuth(request);
  const body = await request.json();

  if (request.method === "POST") {
    const { shopId, subject, description, priority } = body;
    const ticket = await prisma.supportTicket.create({
      data: { shopId, subject, description, priority: priority || "normal", status: "open" }
    });
    return dataResponse({ success: true, ticket });
  }

  if (request.method === "PUT") {
    const { id, status, priority } = body;
    if (!id) return dataResponse({ error: "Missing ID" }, { status: 400 });

    const ticket = await prisma.supportTicket.update({ where: { id }, data: { status, priority } });

    await prisma.auditLog.create({
      data: {
        adminId: admin.id,
        action: "update_ticket",
        resource: `ticket:${id}`,
        details: JSON.stringify({ status, priority })
      }
    });

    return dataResponse({ success: true, ticket });
  }

  return dataResponse({ error: "Method not allowed" }, { status: 405 });
}
