import { PrismaClient } from '@prisma/client';
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

async function run() {
  const shop = "rainyb2b.myshopify.com";
  console.log("Checking DB for session...");
  const sessionData = await prisma.session.findFirst({ where: { shop: shop }});
  
  if (!sessionData) {
      console.log("No session found for", shop);
      return;
  }
  
  const session = {
    id: sessionData.id,
    shop: sessionData.shop,
    state: sessionData.state,
    isOnline: sessionData.isOnline,
    accessToken: sessionData.accessToken,
    scope: sessionData.scope
  };

  const client = new shopify.clients.Graphql({ session } as any);

  try {
     console.log("Fetching Functions...");
     const fRes = await client.request(`
        query { shopifyFunctions(first: 25) { edges { node { id title apiType } } } }
     `);
     const fJson = fRes.data as any;
     console.log("Functions:", JSON.stringify(fJson, null, 2));

     const b2bFunction = fJson?.shopifyFunctions?.edges?.find(
        (e: any) => e.node.apiType === "product_discounts" || e.node.title.includes("tier-discount") || e.node.title.includes("b2b")
     )?.node;

     if (!b2bFunction) {
         console.log("Function NOT deployed to store!");
         return;
     }

     console.log("Fetching Discounts...");
     const dRes = await client.request(`
        query { discountNodes(first: 25) { edges { node { id discount { ... on DiscountAutomaticApp { title status } } } } } }
     `);
     const dJson = dRes.data as any;
     console.log("Discounts:", JSON.stringify(dJson, null, 2));

     const alreadyExists = dJson?.discountNodes?.edges?.some(
         (e: any) => e.node.discount?.title === "B2B Tier Discount"
     );

     if (!alreadyExists) {
        console.log("Creating discount manually via script...");
             const cRes = await client.request(`
                mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
                  discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { userErrors { field message } }
                }
             `, {
                 variables: {
                     automaticAppDiscount: { title: "B2B Tier Discount", functionId: b2bFunction.id, startsAt: new Date().toISOString() }
                 }
             });
         console.log("CREATE RESULT:", JSON.stringify(cRes.data));
     }

  } catch (e) {
      console.error(e);
  }
}

run();
