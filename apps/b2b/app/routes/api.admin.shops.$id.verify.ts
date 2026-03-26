import { data as dataResponse } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import shopify, { unauthenticated } from "../shopify.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminAuth(request);
  const shop = params.id; // Shop ID is the domain

  if (!shop) {
    return dataResponse({ error: "Shop domain is required" }, { status: 400 });
  }

  try {
    // Attempt to get an unauthenticated admin client for this shop
    // This will check if we have a valid offline session in the database
    const { admin } = await unauthenticated.admin(shop);

    // If we have a client, try a simple query to verify the token is actually valid
    const response = await admin.graphql(`
      query verifyToken {
        shop {
          name
        }
      }
    `);

    if (response.ok) {
      return dataResponse({
        connected: true,
        message: "API Token is valid and connected.",
        timestamp: new Date().toISOString()
      });
    } else {
      const errorData = await response.json();
      return dataResponse({
        connected: false,
        message: "Shopify returned an error. Token might be revoked.",
        details: errorData,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error: any) {
    console.error(`[API Verify Error] for ${shop}:`, error);
    return dataResponse({
      connected: false,
      message: error.message || "Failed to connect to Shopify. Session might be missing or expired.",
      timestamp: new Date().toISOString()
    }, { status: 200 }); // Return 200 so UI can handle the "disconnected" state gracefully
  }
}
