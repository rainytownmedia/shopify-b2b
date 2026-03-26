import { createCookieSessionStorage } from "react-router";
import prisma from "../db.server";

const sessionSecret = process.env.SESSION_SECRET || "fallback_admin_secret_9999";

export const adminSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__admin_session",
    secure: process.env.NODE_ENV === "production",
    secrets: [sessionSecret],
    sameSite: "lax",
    path: "/",
    httpOnly: true,
  },
});

export async function getAdminFromRequest(request: Request) {
  const session = await adminSessionStorage.getSession(request.headers.get("Cookie"));
  if (!session.has("adminId")) return null;

  const adminId = session.get("adminId") as string;
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId, isActive: true },
    select: { id: true, email: true, name: true, role: true }
  });

  return admin || null;
}

export async function requireAdminAuth(request: Request) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  return admin;
}

export async function createAdminSession(adminId: string) {
  const session = await adminSessionStorage.getSession();
  session.set("adminId", adminId);
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": await adminSessionStorage.commitSession(session),
    },
  });
}

export async function destroyAdminSession(request: Request) {
  const session = await adminSessionStorage.getSession(request.headers.get("Cookie"));
  return new Response(JSON.stringify({ success: true, message: "Logged out" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": await adminSessionStorage.destroySession(session),
    },
  });
}
