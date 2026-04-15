import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useEffect, useState, useRef } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
     // Auto-setup the Discount Function if not already created
  try {
     const functionsRes = await admin.graphql(`
        #graphql
        query {
           shopifyFunctions(first: 25) { edges { node { id title apiType } } }
        }
     `);
     const fJson = await functionsRes.json();
     const functions = fJson.data?.shopifyFunctions?.edges || [];
     
     const tierFunction = functions.find((e: any) => e.node.apiType === "product_discounts" && (e.node.title.toLowerCase().includes("tier") || e.node.title.toLowerCase().includes("b2b")))?.node;
     const cartFunction = functions.find((e: any) => e.node.apiType === "order_discounts" && (e.node.title.toLowerCase().includes("cart") || e.node.title.toLowerCase().includes("b2b")))?.node;

     // 1. Auto-setup Tier Discount (Product)
     if (tierFunction) {
          const checkRes = await admin.graphql(`
             #graphql
             query { discountNodes(first: 50) { edges { node { id discount { ... on DiscountAutomaticApp { title } } } } } }
          `);
          const checkJson = await checkRes.json();
          const tierNode = checkJson.data?.discountNodes?.edges?.find((e: any) => e.node.discount?.title === "B2B Tier Discount")?.node;

          if (!tierNode) {
              console.log("Auto-creating B2B Tier Discount Function...");
              await admin.graphql(`
                 #graphql
                 mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
                   discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { userErrors { field message } }
                 }
              `, {
                  variables: {
                      automaticAppDiscount: { 
                          title: "B2B Tier Discount", 
                          functionId: tierFunction.id, 
                          startsAt: new Date().toISOString(),
                          combinesWith: { orderDiscounts: true }
                      }
                  }
              });
          } else {
              // Auto-update existing to ensure Combines With is enabled
              await admin.graphql(`
                 #graphql
                 mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
                   discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) { userErrors { field message } }
                 }
              `, {
                  variables: {
                      id: tierNode.id,
                      automaticAppDiscount: { combinesWith: { orderDiscounts: true } }
                  }
              });
          }
     }

     // 2. Auto-setup Cart Discount (Order)
     if (cartFunction) {
          const checkRes = await admin.graphql(`
            #graphql
            query { discountNodes(first: 50) { edges { node { id discount { ... on DiscountAutomaticApp { title } } } } } }
          `);
          const checkJson = await checkRes.json();
          const cartNode = checkJson.data?.discountNodes?.edges?.find((e: any) => e.node.discount?.title === "B2B Cart Discount")?.node;

          if (!cartNode) {
              console.log("Auto-creating B2B Cart Discount Function...");
              await admin.graphql(`
                 #graphql
                 mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
                   discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) { userErrors { field message } }
                 }
              `, {
                  variables: {
                      automaticAppDiscount: { 
                          title: "B2B Cart Discount", 
                          functionId: cartFunction.id, 
                          startsAt: new Date().toISOString(),
                          combinesWith: { productDiscounts: true }
                      }
                  }
              });
          } else {
              // Auto-update existing to ensure Combines With is enabled
              await admin.graphql(`
                 #graphql
                 mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
                   discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) { userErrors { field message } }
                 }
              `, {
                  variables: {
                      id: cartNode.id,
                      automaticAppDiscount: { combinesWith: { productDiscounts: true } }
                  }
              });
          }
     }
  } catch (err) {
     console.error("AutoSetup error:", err);
  }

  // Check if historical tags sync is needed
  let needsTagSync = false;
  const existingLog = await db.activityLog.findFirst({
      where: { shopId: session.shop, action: "SYNC_ALL_TAGS_COMPLETED" }
  });

  if (!existingLog) {
      // Fast check if any customers exist
      const checkRes = await admin.graphql(`
        #graphql
        query {
            customers(first: 1) { edges { node { id } } }
        }
      `);
      const checkJson = await checkRes.json();
      if ((checkJson.data as any)?.customers?.edges?.length > 0) {
          needsTagSync = true;
      } else {
          // No customers, mark as completed immediately
          await db.activityLog.create({
              data: { shopId: session.shop, action: "SYNC_ALL_TAGS_COMPLETED" }
          });
      }
  }

  return { shop: "Store", needsTagSync };
};

export default function Dashboard() {
  const { shop, needsTagSync } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0); 
  const syncedCountRef = useRef(0);
  const [syncComplete, setSyncComplete] = useState(false);

  // Background Auto-Sync logic
  useEffect(() => {
    if (!needsTagSync || syncComplete) return;

    if (!isSyncing && fetcher.state === "idle" && !fetcher.data) {
        setIsSyncing(true);
        fetcher.submit({ actionType: "SYNC_CHUNK", cursor: "" }, { method: "POST", action: "/api/admin/sync" });
    } else if (fetcher.state === "idle" && fetcher.data) {
        const data = fetcher.data as any;
        if (data.success) {
            syncedCountRef.current += data.syncedCount || 0;
            setSyncProgress((prev) => Math.min(prev + 15, 95)); // rough estimate bump

            if (data.hasNextPage) {
                // Continue fetching the next chunk
                fetcher.submit({ actionType: "SYNC_CHUNK", cursor: data.endCursor }, { method: "POST", action: "/api/admin/sync" });
            } else {
                // Done!
                setSyncProgress(100);
                setTimeout(() => {
                    setSyncComplete(true);
                    setIsSyncing(false);
                }, 1500);
            }
        }
    }
  }, [needsTagSync, fetcher.state, fetcher.data, isSyncing, syncComplete]);

  return (
    <s-page heading="Rainytownmedia Wholesale Dashboard">
      {/* Onboarding Sync Banner */}
      {needsTagSync && !syncComplete && (
        <div style={{
          background: "white", padding: "20px 25px", borderRadius: "12px", border: "1px solid #73bced", 
          borderLeft: "4px solid #005bd3", marginBottom: "25px", display: "flex", flexDirection: "column", gap: "15px"
        }}>
          <div>
            <h3 style={{ fontSize: "1.1em", fontWeight: "bold", margin: "0 0 5px 0", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "1.2em" }}>🔄</span> Syncing Historical Customers...
            </h3>
            <p style={{ margin: 0, color: "#6d7175", fontSize: "0.95em" }}>
              We detected existing customers on your store. We are automatically syncing their B2B data in the background so that they can access wholesale pricing immediately.
            </p>
          </div>
          
          <div style={{ background: "#f4f6f8", height: "8px", borderRadius: "4px", width: "100%", overflow: "hidden", position: "relative" }}>
             <div style={{ 
                height: "100%", background: "#005bd3", borderRadius: "4px", 
                width: `${syncProgress}%`, transition: "width 0.5s ease" 
             }}></div>
          </div>
          <div style={{ fontSize: "0.85em", color: "#6d7175", textAlign: "right" }}>
            {syncProgress === 100 ? "Complete!" : `Processing block... (${syncedCountRef.current} synced)`}
          </div>
        </div>
      )}

      {/* Welcome Banner */}
      <div style={{
        background: "linear-gradient(135deg, #005bd3 0%, #002e6b 100%)",
        padding: "40px",
        borderRadius: "16px",
        color: "white",
        marginBottom: "30px",
        boxShadow: "0 10px 20px rgba(0,91,211,0.15)",
        position: "relative",
        overflow: "hidden"
      }}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h1 style={{ fontSize: "2em", fontWeight: "bold", marginBottom: "10px" }}>Welcome to Rainytownmedia Wholesale</h1>
          <p style={{ fontSize: "1.1em", opacity: 0.9, maxWidth: "600px" }}>
            Ready to boost your sales? Set up tier pricing, create exclusive wholesale offers, and incentivize larger orders with cart discounts.
          </p>
        </div>
        <div style={{ position: "absolute", right: "-20px", top: "-20px", width: "200px", height: "200px", background: "rgba(255,255,255,0.05)", borderRadius: "50%", zIndex: 0 }}></div>
      </div>

      {/* Main Feature Pillars - 2x2 Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px", marginBottom: "30px" }}>
        {/* Tier Pricing Card */}
        <div style={featureCardStyle} onClick={() => navigate("/app/tier-pricing")}>
          <div style={{ ...iconCircleStyle, background: "#f1f8e9", color: "#33691e" }}>💹</div>
          <h3 style={featureTitleStyle}>Tier Pricing</h3>
          <p style={featureDescStyle}>Quantity-based discounts for individual products and variants.</p>
          <div style={arrowStyle}>→</div>
        </div>

        {/* Wholesale Offers Card */}
        <div style={featureCardStyle} onClick={() => navigate("/app/wholesale-offers")}>
          <div style={{ ...iconCircleStyle, background: "#fff9db", color: "#856404" }}>🛍️</div>
          <h3 style={featureTitleStyle}>Wholesale Offers</h3>
          <p style={featureDescStyle}>Bulk rules across multiple products or entire collections.</p>
          <div style={arrowStyle}>→</div>
        </div>

        {/* Cart Discounts Card */}
        <div style={featureCardStyle} onClick={() => navigate("/app/cart-discount")}>
          <div style={{ ...iconCircleStyle, background: "#e1f5fe", color: "#01579b" }}>🛒</div>
          <h3 style={featureTitleStyle}>Cart Discounts</h3>
          <p style={featureDescStyle}>Incentivize larger orders with total subtotal-based discounts.</p>
          <div style={arrowStyle}>→</div>
        </div>

        {/* Checkout Rules Card */}
        <div style={featureCardStyle} onClick={() => navigate("/app/checkout-rules")}>
          <div style={{ ...iconCircleStyle, background: "#f3e5f5", color: "#7b1fa2" }}>🛡️</div>
          <h3 style={featureTitleStyle}>Checkout Rules</h3>
          <p style={featureDescStyle}>Hide shipping or payment methods based on customer groups or order value.</p>
          <div style={arrowStyle}>→</div>
        </div>
      </div>

      {/* Getting Started / Footer Section */}
      <div style={{ background: "white", padding: "30px", borderRadius: "16px", border: "1px solid #e1e1e1", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: "1.2em", fontWeight: "bold", marginBottom: "8px" }}>New to Rainy Wholesale?</h2>
          <p style={{ color: "#6d7175" }}>Check out our 5-minute setup guide to learn how to integrate these rules into your theme.</p>
        </div>
        <s-button variant="secondary" onClick={() => window.open("#", "_blank")}>Read Documentation</s-button>
      </div>
    </s-page>
  );
}

// Styles
const featureCardStyle: React.CSSProperties = {
  background: "white",
  padding: "30px",
  borderRadius: "20px",
  border: "1px solid #e1e1e1",
  boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
  transition: "transform 0.2s, box-shadow 0.2s, border-color 0.2s",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  position: "relative"
};

const iconCircleStyle: React.CSSProperties = {
  width: "50px",
  height: "50px",
  borderRadius: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "1.5em",
  marginBottom: "20px"
};

const featureTitleStyle: React.CSSProperties = {
  fontSize: "1.25em",
  fontWeight: "bold",
  marginBottom: "10px",
  color: "#202223"
};

const featureDescStyle: React.CSSProperties = {
  color: "#6d7175",
  fontSize: "0.95em",
  lineHeight: "1.5",
  flex: 1
};

const arrowStyle: React.CSSProperties = {
  marginTop: "20px",
  fontSize: "1.2em",
  color: "#005bd3",
  fontWeight: "bold"
};
