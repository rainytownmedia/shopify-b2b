import type { ActionFunctionArgs } from "react-router";
import { data as dataResponse } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdminAuth(request);

  if (request.method !== "POST") {
    return dataResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const { shopId, subject, message } = await request.json();

  if (!shopId || !subject || !message) {
    return dataResponse({ error: "shopId, subject, and message are required" }, { status: 400 });
  }

  await prisma.activityLog.create({
    data: {
      shopId,
      action: "admin_notification_sent",
      details: JSON.stringify({ subject, message, sentBy: admin.id }),
    }
  });

  return dataResponse({ success: true, message: "Notification queued successfully." });
}
