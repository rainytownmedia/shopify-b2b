import { useLoaderData, useSubmit, useNavigation, useActionData, redirect } from "react-router";
import { useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge, ProgressBar, Box, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { checkUsage } from "../utils/quota.server";
import db from "../db.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { PLANS, PLAN_FREE, PLAN_PRO, PLAN_UNLIMITED } from "../config/plans.config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  // 1. Persist/Update the host in Database for this shop
  const host = url.searchParams.get("host");
  if (host) {
    await db.shop.update({
      where: { id: session.shop },
      data: { host }
    });
  }
  
  // Get all active plans from DB
  const dbPlans = await db.appPlan.findMany({
    where: { isActive: true },
    orderBy: { price: "asc" }
  });

  // Check active shopify subscriptions
  const billingCheck = await billing.check({
    plans: dbPlans.map(p => p.name) as any,
    isTest: true,
  });

  let activePlanName = "Free";
  if (billingCheck.hasActivePayment) {
     const activeSub = billingCheck.appSubscriptions.find(sub => dbPlans.some(p => p.name === sub.name));
     if (activeSub) activePlanName = activeSub.name;
  }

  // Find current plan details from our DB list or default to Free
  const currentPlanDetails = dbPlans.find(p => p.name === activePlanName);

  // Sync / Grandfathering logic
  const shopData = await db.shop.findUnique({ where: { id: session.shop } });
  if (shopData && shopData.plan !== activePlanName) {
    // Dynamic limit logic based on centralized config
    let expectedRowLimit = PLANS[PLAN_FREE].maxRowLimit;
    let expectedGbLimit = PLANS[PLAN_FREE].displayGbLimit;

    if (currentPlanDetails) {
        const config = PLANS[currentPlanDetails.name];
        if (config) {
            expectedRowLimit = config.maxRowLimit;
            expectedGbLimit = config.displayGbLimit;
        }
    }

    await db.shop.update({
      where: { id: session.shop },
      data: { plan: activePlanName, maxRowLimit: expectedRowLimit, displayGbLimit: expectedGbLimit }
    });
  }

  const usage = await checkUsage(session.shop);
  const hostParam = url.searchParams.get("host");
  const success = url.searchParams.get("success") === "true";

  return {
    activePlan: activePlanName,
    usage,
    availablePlans: dbPlans,
    host: hostParam,
    success,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan") as string;
  const hostFromForm = formData.get("host") as string;
  const url = new URL(request.url);

  console.log("Billing action triggered for plan:", plan);
  const host = hostFromForm || url.searchParams.get("host") || "";
  console.log("Resolved host for billing return:", host);

  // Verify plan exists in DB or is Free
  const planExists = plan === "Free" || await db.appPlan.findUnique({ where: { name: plan } });

  try {
    if (!planExists) {
        throw new Error("Invalid plan selected");
    }

    // CASE 1: Downgrade to Free
    if (plan === "Free") {
      console.log("Processing downgrade to Free plan...");
      
      // 1. Get all active subscriptions
      const checkCharge = await billing.check({
        plans: [PLAN_PRO, PLAN_UNLIMITED] as any,
        isTest: true,
      });

      console.log("Subscriptions found to cancel:", checkCharge.appSubscriptions.length);

      // 2. Cancel each active subscription found
      for (const sub of checkCharge.appSubscriptions) {
        if (sub.status === "ACTIVE") {
          console.log(`Cancelling subscription: ${sub.id}`);
          const response = await admin.graphql(
            `#graphql
            mutation appSubscriptionCancel($id: ID!) {
              appSubscriptionCancel(id: $id) {
                userErrors { field message }
              }
            }`,
            { variables: { id: sub.id } }
          );
          const result = await response.json();
          console.log(`Cancellation result for ${sub.id}:`, JSON.stringify(result, null, 2));
        }
      }

      // 3. Update DB to reflect Free status and basic limits
      const freeConfig = PLANS[PLAN_FREE];
      await db.shop.update({
        where: { id: session.shop },
        data: { 
            plan: PLAN_FREE, 
            maxRowLimit: freeConfig.maxRowLimit, 
            displayGbLimit: freeConfig.displayGbLimit,
            subscriptionStatus: "CANCELED"
        }
      });

      console.log("Downgrade to Free completed successfully");
      return { success: true, plan: "Free" };
    }

    // CASE 2: Upgrade/Switch to Paid Plan
    if (plan !== "Free") {
      console.log("Checking billing status for plan:", plan);
      // ... existing paid plan logic ...
      const checkCharge = await billing.check({
        plans: [plan] as any,
        isTest: true,
      });

      console.log("Current billing check result:", JSON.stringify(checkCharge, null, 2));

      // 2. If no active charge for this plan, request it
      if (!checkCharge.hasActivePayment) {
        console.log("Initiating billing.request for plan:", plan);

        let host = url.searchParams.get("host") || formData.get("host")?.toString();
        
        if (!host) {
          console.log("Host missing in request. Attempting to fetch from Database...");
          const shopData = await db.shop.findUnique({ 
            where: { id: session.shop }, 
            select: { host: true } 
          });
          host = shopData?.host || "";
        }

        console.log("Host resolved:", host);

        // Construct the correct returnUrl using the Shopify Admin embedded app URL format.
        // host is base64 encoded "admin.shopify.com/store/{store-name}"
        // The correct returnUrl must point to admin.shopify.com so Shopify re-embeds the app correctly.
        let returnUrl: string;
        if (host) {
          // Decode host from base64: gives "admin.shopify.com/store/{store-name}"
          const decodedHost = Buffer.from(host, "base64").toString("utf-8");
          // App handle from Shopify Admin (seen in URL: /apps/rainytownmedia-b2b)
          const appHandle = "rainytownmedia-b2b";
          returnUrl = `https://${decodedHost}/apps/${appHandle}/pricing?success=true`;
        } else {
          // Fallback: use the tunnel URL (less reliable but better than nothing)
          const origin = url.origin.startsWith("http://")
            ? url.origin.replace("http://", "https://")
            : url.origin;
          returnUrl = `${origin}/app/pricing?success=true&shop=${encodeURIComponent(session.shop)}`;
        }
        
        console.log("Final returnUrl:", returnUrl);

        // billing.request() throws a redirect Response — DO NOT catch it, let it propagate
        // React Router / Shopify App framework will handle the redirect automatically
        return await billing.request({
          plan: plan as any,
          isTest: true,
          returnUrl,
        });
      } else {
        console.log("Shop already has an active payment for this plan.");
        return { success: true, alreadyActive: true };
      }
    }
  } catch (error: any) {
    if (error instanceof Response) {
      console.log("Re-throwing Response from billing action (status, headers):", error.status, JSON.stringify(Object.fromEntries(error.headers.entries())));
      throw error;
    }

    // Actual unexpected error
    console.error("Unexpected billing error:", error);
    return { 
      success: false, 
      error: error.message || "Unknown billing error",
    };
  }

  return { success: true };
};

export default function PricingPage() {
  const { activePlan, usage, availablePlans, host, success } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const isLoading = navigation.state === "submitting" || (navigation.state === "loading" && navigation.formData?.get("plan"));

  // billing.request() is handled entirely server-side as a redirect response.
  // No client-side redirect needed.
 
  const progressPercent = usage.maxRowLimit > 0 ? Math.min(100, (usage.totalRows / usage.maxRowLimit) * 100) : 0;
 
  const handleUpgrade = (plan: string) => {
    console.log("Client-side: Initiating upgrade to plan:", plan, "with host:", host);
    // 1. Pass host in the formData
    // 2. IMPORTANT: Also append current search params (shop, host) to the action URL 
    // so that authenticate.admin(request) can identify the session.
    const searchParams = new URLSearchParams(window.location.search);
    submit(
      { plan, host: host || "" }, 
      { 
        method: "post", 
        action: `?${searchParams.toString()}` 
      }
    );
  };

  return (
    <Page title="Plans & Pricing">
      <Layout>
        {/* Error Messages */}
        {actionData && "error" in actionData && actionData.error && (
          <Layout.Section>
            <Banner title="Billing Error" tone="critical">
              <p>{actionData.error as string}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Usage Overview */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Data Usage ({activePlan} Plan)</Text>
                {usage.isLimitReached && (
                   <Badge tone="critical">Limit Reached</Badge>
                )}
                {!usage.isLimitReached && usage.isWarning && (
                   <Badge tone="warning">Approaching Limit</Badge>
                )}
              </InlineStack>
              
              <Box paddingBlockStart="200" paddingBlockEnd="200">
                 <ProgressBar progress={progressPercent} tone={usage.isLimitReached ? "critical" : usage.isWarning ? "highlight" : "primary"} />
              </Box>
              
              <InlineStack align="space-between">
                <div></div>
                <Text as="p" fontWeight="bold">
                   {usage.currentGb} GB / {usage.displayGbLimit >= 9999 ? "∞" : `${usage.displayGbLimit} GB`}
                </Text>
              </InlineStack>

              {usage.isLimitReached && (
                 <Text as="p" tone="critical">
                    You have reached your storage limit. Please upgrade your plan to continue adding new rules.
                 </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Dynamic Pricing Cards */}
        <Layout.Section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginTop: '10px' }}>
            
            {/* Displaying plans from Database */}
            {availablePlans.map((plan: any) => (
              <Card key={plan.id} background={plan.price >= 50 ? "bg-surface-brand" : undefined}>
                <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                  <BlockStack gap="400" align="space-between">
                    <div>
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingLg">{plan.name}</Text>
                        {activePlan === plan.name && <Badge tone="success">Active Plan</Badge>}
                      </InlineStack>
                      
                      <Box paddingBlockStart="200" paddingBlockEnd="400">
                        <Text as="p" variant="headingXl">${plan.price} <span style={{ fontSize: "16px", color: plan.price >= 50 ? "#eee" : "#666", fontWeight: "normal" }}>/ {plan.interval === 'EVERY_30_DAYS' ? 'month' : 'year'}</span></Text>
                      </Box>
                      
                      <Text as="p" tone="subdued">{plan.description}</Text>
                      
                      <Box paddingBlockStart="400">
                        <ul style={{ paddingLeft: "20px", listStyleType: "disc", lineHeight: "1.8" }}>
                          {JSON.parse(plan.features || '[]').map((f: string, i: number) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      </Box>
                    </div>

                    <Box paddingBlockStart="400">
                      <Button 
                        fullWidth 
                        variant={activePlan === plan.name ? "secondary" : "primary"} 
                        disabled={activePlan === plan.name || !!isLoading}
                        loading={!!isLoading && navigation.formData?.get("plan") === plan.name}
                        onClick={() => handleUpgrade(plan.name)}
                      >
                        {activePlan === plan.name ? "Current Plan" : "Select Plan"}
                      </Button>
                    </Box>
                  </BlockStack>
                </div>
              </Card>
            ))}

            {availablePlans.length === 0 && (
              <Box padding="400">
                <Text as="p" tone="subdued">No active plans available at the moment. Please contact support.</Text>
              </Box>
            )}

          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
