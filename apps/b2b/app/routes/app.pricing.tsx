import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge, ProgressBar, Box, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { checkUsage } from "../utils/quota.server";
import db from "../db.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  
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
    // Dynamic limit logic based on DB description or defaults
    let expectedRowLimit = 1000;
    let expectedGbLimit = 5.0;

    if (currentPlanDetails) {
       // Extract limits from features or description if possible, or use defaults
       // For this implementation, we'll use price thresholds as defaults
       if (currentPlanDetails.price >= 50) {
          expectedRowLimit = 999999999;
          expectedGbLimit = 9999.0;
       } else if (currentPlanDetails.price >= 20) {
          expectedRowLimit = 2000;
          expectedGbLimit = 10.0;
       }
    }

    await db.shop.update({
      where: { id: session.shop },
      data: { plan: activePlanName, maxRowLimit: expectedRowLimit, displayGbLimit: expectedGbLimit }
    });
  }

  const usage = await checkUsage(session.shop);

  return {
    activePlan: activePlanName,
    usage,
    availablePlans: dbPlans
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan") as string;
  const url = new URL(request.url);

  console.log("Billing action triggered for plan:", plan);
  console.log("URL origin for billing return:", url.origin);

  // Verify plan exists in DB
  const planExists = await db.appPlan.findUnique({ where: { name: plan } });

  try {
    if (planExists && plan !== "Free") {
      console.log("Checking billing status for plan:", plan);
      // 1. Check if the shop already has the selected plan
      const checkCharge = await billing.check({
        plans: [plan] as any,
        isTest: true,
      });

      console.log("Billing check result - hasActivePayment:", checkCharge.hasActivePayment);

      // 2. If no active charge for this plan, request it
      if (!checkCharge.hasActivePayment) {
        console.log("Initiating billing.request for plan:", plan);
        try {
          // MUST use https for returnUrl
          const returnUrl = `${url.origin.replace("http://", "https://")}/app/pricing`;
          console.log("Forced HTTPS returnUrl:", returnUrl);

          return await billing.request({
            plan: plan as any,
            isTest: true,
            returnUrl,
          });
        } catch (requestError: any) {
          console.error("Detailed error in billing.request:", requestError);
          // Extract GraphQL errors if available
          const graphQLErrors = requestError.response?.errors || requestError.errors;
          if (graphQLErrors) {
            console.error("GraphQL Errors:", JSON.stringify(graphQLErrors, null, 2));
            throw new Error(`Shopify GraphQL Error: ${JSON.stringify(graphQLErrors)}`);
          }
          throw requestError;
        }
      }
    }
  } catch (error: any) {
    if (error instanceof Response) {
      // Special handling for 401 reauthorization (Billing confirm page)
      if (error.status === 401 && error.headers.has('X-Shopify-API-Request-Failure-Reauthorize-Url')) {
        const redirectUrl = error.headers.get('X-Shopify-API-Request-Failure-Reauthorize-Url');
        console.log("Directing client to reauthorization URL:", redirectUrl);
        return { redirectUrl };
      }
      throw error;
    }

    console.error("Final catch in billing action:", error);
    
    return { 
      success: false, 
      error: error.message || "Unknown billing error",
      details: error.stack || "No stack trace available"
    };
  }

  return { success: true };
};

export default function PricingPage() {
  const { activePlan, usage, availablePlans } = useLoaderData<typeof loader>();
  const actionData = useActionData<any>();
  const submit = useSubmit();
  const navigation = useNavigation();

  useEffect(() => {
    if (actionData?.redirectUrl) {
      console.log("Redirecting to Shopify Billing page...");
      if (window.top) {
        window.top.location.href = actionData.redirectUrl;
      } else {
        window.location.href = actionData.redirectUrl;
      }
    }
  }, [actionData]);

  const isSubmitting = navigation.state === "submitting";
  const progressPercent = usage.maxRowLimit > 0 ? Math.min(100, (usage.totalRows / usage.maxRowLimit) * 100) : 0;

  const handleUpgrade = (plan: string) => {
    console.log("Client-side: Initiating upgrade to plan:", plan);
    submit({ plan }, { method: "post" });
  };

  return (
    <Page title="Plans & Pricing">
      <Layout>
        {/* Error Messages */}
        {actionData?.error && (
          <Layout.Section>
            <Banner title="Billing Error" tone="critical">
              <p>{actionData.error}</p>
              {actionData.details && (
                <Box paddingBlockStart="200">
                   <Text as="p" variant="bodySm" tone="subdued">Technical Details: {actionData.details}</Text>
                </Box>
              )}
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
                <Text as="p" tone="subdued">{usage.totalRows} rules used</Text>
                <Text as="p" fontWeight="bold">
                   {usage.currentGb} GB / {usage.maxRowLimit === 999999999 ? "∞" : `${usage.displayGbLimit} GB`}
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
                        disabled={activePlan === plan.name || isSubmitting}
                        loading={isSubmitting}
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
