import { PrismaClient } from '@prisma/client';
import '@shopify/shopify-api/adapters/node';
import { shopifyApi } from '@shopify/shopify-api';
import 'dotenv/config';

const prisma = new PrismaClient();

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY as string,
  apiSecretKey: process.env.SHOPIFY_API_SECRET as string,
  scopes: (process.env.SCOPES as string).split(','),
  hostName: (process.env.SHOPIFY_APP_URL as string).replace(/https:\/\//, ''),
  apiVersion: '2024-01' as any,
  isEmbeddedApp: true,
});

async function main() {
  // Use the second shop which had success
  const sessionData = await prisma.session.findFirst({ 
    where: { shop: { contains: "b2b-2" } }
  }) ?? await prisma.session.findFirst();
  
  if (!sessionData) { console.log("No session!"); return; }
  console.log("Using shop:", sessionData.shop);

  const client = new shopify.clients.Graphql({ session: sessionData as any });

  // 1. Check the shipping_rules metafield
  console.log("\n=== Checking shipping_rules Metafield ===");
  const mRes = await client.request(`
    query {
      shop {
        metafield(namespace: "b2b_app", key: "shipping_rules") {
          id
          value
          updatedAt
        }
      }
    }
  `);
  const mJson = mRes.data as any;
  const metaVal = mJson?.shop?.metafield?.value;
  console.log("Metafield value:", metaVal ? JSON.stringify(JSON.parse(metaVal), null, 2) : "NOT FOUND");

  // 2. Check delivery customizations
  console.log("\n=== Checking Delivery Customizations ===");
  const dRes = await client.request(`
    query {
      deliveryCustomizations(first: 10) {
        edges {
          node {
            id
            title
            enabled
            functionId
          }
        }
      }
    }
  `);
  const dJson = dRes.data as any;
  console.log("Delivery Customizations:", JSON.stringify(dJson?.deliveryCustomizations?.edges, null, 2));

  // 3. Check deployed functions
  console.log("\n=== Checking Shopify Functions ===");
  const fRes = await client.request(`
    query { shopifyFunctions(first: 25) { edges { node { id title apiType } } } }
  `);
  const fJson = fRes.data as any;
  const functions = fJson?.shopifyFunctions?.edges || [];
  functions.forEach((f: any) => {
    console.log(`  - ${f.node.title} | apiType: ${f.node.apiType} | id: ${f.node.id}`);
  });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
