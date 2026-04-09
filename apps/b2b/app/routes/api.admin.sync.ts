import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  // Can be 'CHECK_STATUS' or 'SYNC_CHUNK'
  const actionType = formData.get("actionType") as string;

  if (actionType === "CHECK_STATUS") {
    // Check if we have already fully synced the historical store data
    const existingLog = await db.activityLog.findFirst({
        where: { shopId: session.shop, action: "SYNC_ALL_TAGS_COMPLETED" }
    });

    if (existingLog) {
        return { isCompleted: true };
    }

    // Double check if there are even any customers to sync
    const checkRes = await admin.graphql(`
        #graphql
        query {
            customers(first: 1) { edges { node { id } } }
        }
    `);
    const checkJson: any = await checkRes.json();
    if (checkJson.data?.customers?.edges?.length === 0) {
        // Empty store, just mark it complete
        await db.activityLog.create({
            data: { shopId: session.shop, action: "SYNC_ALL_TAGS_COMPLETED" }
        });
        return { isCompleted: true };
    }

    return { isCompleted: false };
  }

  if (actionType === "SYNC_CHUNK") {
      const cursor = formData.get("cursor") as string | null;
      const cursorArg = cursor ? `, after: "${cursor}"` : "";

      const response = await admin.graphql(
         `#graphql
         query getCustomersChunk {
            customers(first: 50${cursorArg}) {
               pageInfo {
                  hasNextPage
                  endCursor
               }
               edges {
                  node {
                     id
                     tags
                  }
               }
            }
         }`
      );
      
      const customerJson: any = await response.json();
      const pageInfo = customerJson.data?.customers?.pageInfo;
      const customers = customerJson.data?.customers?.edges || [];
      
      const metafields = customers.map((c: any) => {
         const tags = c.node.tags || [];
         return {
            ownerId: c.node.id,
            namespace: "b2b_app",
            key: "b2b_tags",
            type: "json",
            value: JSON.stringify(tags)
         };
      });

      if (metafields.length > 0) {
         // Batch into groups of 25 to respect mutation limits
         const chunkSize = 25;
         for (let i = 0; i < metafields.length; i += chunkSize) {
            const chunk = metafields.slice(i, i + chunkSize);
            await admin.graphql(
               `#graphql
               mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
                  metafieldsSet(metafields: $metafields) {
                     userErrors {
                        field
                        message
                     }
                  }
               }`,
               { variables: { metafields: chunk } }
            );
         }
      }

      const hasNextPage = pageInfo?.hasNextPage;
      const endCursor = pageInfo?.endCursor;

      // If finished, mark it complete!
      if (!hasNextPage) {
           await db.activityLog.create({
               data: { shopId: session.shop, action: "SYNC_ALL_TAGS_COMPLETED" }
           });
      }

      return { 
          success: true, 
          syncedCount: customers.length, 
          hasNextPage, 
          endCursor 
      };
  }

  return { error: "Invalid action" };
};
