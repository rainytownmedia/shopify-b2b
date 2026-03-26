import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data as dataResponse } from "react-router";
import prisma from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminAuth(request);
  const config = await prisma.appConfig.findUnique({ where: { id: "global" } });
  return dataResponse({ data: config ? JSON.parse(config.settings) : {} });
}

export async function action({ request }: ActionFunctionArgs) {
  const admin = await requireAdminAuth(request);
  const body = await request.json();
  const settingsString = JSON.stringify(body);

  const config = await prisma.appConfig.upsert({
    where: { id: "global" },
    update: { settings: settingsString, updatedBy: admin.id },
    create: { id: "global", settings: settingsString, updatedBy: admin.id },
  });

  return dataResponse({ success: true, data: JSON.parse(config.settings) });
}
