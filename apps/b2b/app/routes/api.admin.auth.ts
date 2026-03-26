import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  adminSessionStorage,
  createAdminSession,
  destroyAdminSession,
  getAdminFromRequest,
} from "../services/admin.auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(JSON.stringify({ authenticated: true, admin }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "logout") {
    return destroyAdminSession(request);
  }

  if (intent === "login") {
    const email = formData.get("email");
    const password = formData.get("password");

    if (typeof email !== "string" || typeof password !== "string") {
      return new Response(JSON.stringify({ error: "Invalid form data" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin || admin.password !== password || !admin.isActive) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401, headers: { "Content-Type": "application/json" }
      });
    }

    return createAdminSession(admin.id);
  }

  return new Response(JSON.stringify({ error: "Invalid intent" }), {
    status: 400, headers: { "Content-Type": "application/json" }
  });
}
