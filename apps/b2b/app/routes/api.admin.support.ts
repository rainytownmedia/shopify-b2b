import { data as dataResponse } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminAuth(request);
  const tickets = await db.supportTicket.findMany({
    orderBy: { createdAt: 'desc' }
  });
  return dataResponse({ data: tickets });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdminAuth(request);
  const formData = await request.json();
  const { id, status } = formData;

  if (!id) return dataResponse({ error: "Ticket ID required" }, { status: 400 });

  const updated = await db.supportTicket.update({
    where: { id },
    data: { status }
  });

  return dataResponse({ data: updated });
}
