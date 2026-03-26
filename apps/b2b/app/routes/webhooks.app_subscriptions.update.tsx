import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const subscription = payload.app_subscription;
  if (!subscription) return new Response();

  // Map Shopify status to our internal subscriptionStatus
  // Shopify statuses: PENDING, ACTIVE, DECLINED, EXPIRED, PAST_DUE, CANCELLED
  const status = subscription.status;
  const planName = subscription.name;

  await db.shop.updateMany({
    where: { id: shop },
    data: {
      plan: planName,
      subscriptionStatus: status,
      isActive: status === 'ACTIVE' || status === 'TRIALING'
    },
  });

  return new Response();
};
