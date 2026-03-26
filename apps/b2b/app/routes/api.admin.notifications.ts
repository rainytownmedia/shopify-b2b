import { data as dataResponse } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function action({ request }: ActionFunctionArgs) {
  await requireAdminAuth(request);
  const formData = await request.json();
  const { shopId, title, message, type } = formData;

  if (!shopId || !title || !message) {
    return dataResponse({ error: "Missing required fields" }, { status: 400 });
  }

  // Support broadcast: if shopId is "ALL", notify everyone
  if (shopId === "ALL") {
     const shops = await db.shop.findMany({ select: { id: true } });
     await db.notification.createMany({
       data: shops.map(s => ({
         shopId: s.id,
         title,
         message,
         type: type || "info"
       }))
     });
     return dataResponse({ success: true, count: shops.length });
  }

  const notification = await db.notification.create({
    data: {
      shopId,
      title,
      message,
      type: type || "info"
    }
  });

  return dataResponse({ data: notification });
}
