import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, admin, session, shop, payload } = await authenticate.webhook(request);

  if (topic !== "CUSTOMERS_UPDATE" && topic !== "CUSTOMERS_CREATE") {
    return new Response("Unhandled webhook topic", { status: 404 });
  }

  try {
    const customer = payload as any;
    
    // Shopify webhook payload typically returns comma-separated tags
    let tagsArray: string[] = [];
    if (customer.tags) {
        tagsArray = customer.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t !== "");
    }

    const customerGid = `gid://shopify/Customer/${customer.id}`;

    // Update the Metafield b2b_tags
    const response = await admin!.graphql(
      `#graphql
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: customerGid,
              namespace: "b2b_app",
              key: "b2b_tags",
              type: "json",
              value: JSON.stringify(tagsArray)
            }
          ]
        }
      }
    );

    const json = await response.json();
    if (json.data?.metafieldsSet?.userErrors?.length > 0) {
        console.error(`[Webhook ${topic}] Failed to sync tags for ${customer.id}:`, json.data.metafieldsSet.userErrors);
    } else {
        console.log(`[Webhook ${topic}] Successfully synced tags [${tagsArray.join(', ')}] for customer ${customer.id}`);
    }

    return new Response("Webhook processed", { status: 200 });
  } catch (error) {
    console.error(`[Webhook ${topic}] Error processing payload:`, error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
