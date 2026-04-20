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

async function run() {
  console.log("Checking DB for sessions...");
  const sessions = await prisma.session.findMany();
  
  if (sessions.length === 0) {
      console.log("No sessions found in database!");
      return;
  }

  for (const sessionData of sessions) {
      console.log(`\n--- Processing Shop: ${sessionData.shop} ---`);
      
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
         // 1. Fetch Functions
         console.log("Fetching Functions...");
         const fRes = await client.request(`
            query { shopifyFunctions(first: 25) { edges { node { id title apiType } } } }
         `);
         const fJson = fRes.data as any;
         
         const deliveryFn = fJson?.shopifyFunctions?.edges?.find(
            (e: any) => e.node.apiType === "delivery_customization" || e.node.title.toLowerCase().includes("delivery")
         )?.node;

         const paymentFn = fJson?.shopifyFunctions?.edges?.find(
            (e: any) => e.node.apiType === "payment_customization" || e.node.title.toLowerCase().includes("payment")
         )?.node;

         if (!deliveryFn) {
             console.log("Delivery Function NOT found for this store!");
         } else {
             console.log(`Found Delivery Function: ${deliveryFn.title} (${deliveryFn.id})`);
             
             // Check if already active
             const dRes = await client.request(`
                query { deliveryCustomizations(first: 10) { edges { node { id title enabled functionId } } } }
             `);
             const dJson = dRes.data as any;
             const alreadyExists = dJson?.deliveryCustomizations?.edges?.some(
                 (e: any) => e.node.functionId === deliveryFn.id
             );

             if (alreadyExists) {
                 console.log("Delivery Customization is ALREADY ACTIVE.");
             } else {
                 console.log("Activating Delivery Customization...");
                 const cRes = await client.request(`
                    mutation deliveryCustomizationCreate($deliveryCustomization: DeliveryCustomizationInput!) {
                      deliveryCustomizationCreate(deliveryCustomization: $deliveryCustomization) {
                        deliveryCustomization { id }
                        userErrors { field message }
                      }
                    }
                 `, {
                     variables: {
                         deliveryCustomization: {
                             title: "B2B Delivery Customization",
                             functionId: deliveryFn.id,
                             enabled: true
                         }
                     }
                 });
                 console.log("Activation Result:", JSON.stringify(cRes.data));
             }
         }

         if (!paymentFn) {
            console.log("Payment Function NOT found for this store!");
         } else {
             console.log(`Found Payment Function: ${paymentFn.title} (${paymentFn.id})`);
             
             // Check if already active
             const pRes = await client.request(`
                query { paymentCustomizations(first: 10) { edges { node { id title enabled functionId } } } }
             `);
             const pJson = pRes.data as any;
             const alreadyExists = pJson?.paymentCustomizations?.edges?.some(
                 (e: any) => e.node.functionId === paymentFn.id
             );

             if (alreadyExists) {
                 console.log("Payment Customization is ALREADY ACTIVE.");
             } else {
                 console.log("Activating Payment Customization...");
                 const cRes = await client.request(`
                    mutation paymentCustomizationCreate($paymentCustomization: PaymentCustomizationInput!) {
                      paymentCustomizationCreate(paymentCustomization: $paymentCustomization) {
                        paymentCustomization { id }
                        userErrors { field message }
                      }
                    }
                 `, {
                     variables: {
                         paymentCustomization: {
                             title: "B2B Payment Customization",
                             functionId: paymentFn.id,
                             enabled: true
                         }
                     }
                 });
                 console.log("Activation Result:", JSON.stringify(cRes.data));
             }
         }

      } catch (error: any) {
          console.error(`Error processing shop ${sessionData.shop}:`);
          if (error.response?.errors) {
              console.error("GraphQL Errors:", JSON.stringify(error.response.errors, null, 2));
          } else {
              console.error(error);
          }
      }
  }
}

run().then(() => {
    console.log("\nDone!");
    process.exit(0);
});
