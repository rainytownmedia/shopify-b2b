import { useState, useEffect, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkUsage } from "../utils/quota.server";
import React from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Banner } from "@shopify/polaris";
import { TagCombobox } from "../components/TagCombobox";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [rules, usage, cTagRes] = await Promise.all([
    db.checkoutRule.findMany({
      where: { shopId: session.shop },
      orderBy: { updatedAt: 'desc' }
    }),
    checkUsage(session.shop),
    admin.graphql(`#graphql
      query getCustomerTags {
        customers(first: 250) { edges { node { tags } } }
      }
    `).catch(() => null)
  ]);

  const shopifyTags = new Set<string>();
  if (cTagRes) {
    const cJson: any = await cTagRes.json();
    cJson?.data?.customers?.edges?.forEach((e: any) =>
      e.node.tags.forEach((t: string) => shopifyTags.add(t))
    );
  }
  const dbTags = rules.map(r => r.customerTag).filter(Boolean) as string[];
  const uniqueTags = Array.from(new Set([...dbTags, ...Array.from(shopifyTags)]));
  if (!uniqueTags.includes("ALL")) uniqueTags.unshift("ALL");
  await ensureExtensionsActivated(admin);

  return { rules, usage, uniqueTags };
};

async function ensureExtensionsActivated(admin: any) {
  try {
    // 1. Fetch all deployed functions
    const fRes = await admin.graphql(`#graphql
      query getFunctions {
        shopifyFunctions(first: 25) {
          edges {
            node {
              id
              title
              apiType
            }
          }
        }
      }
    `);
    const fJson: any = await fRes.json();
    const functions = fJson?.data?.shopifyFunctions?.edges || [];

    const deliveryFn = functions.find((e: any) => 
      e.node.apiType === "delivery_customization" || e.node.title.includes("Delivery")
    )?.node;

    const paymentFn = functions.find((e: any) => 
      e.node.apiType === "payment_customization" || e.node.title.includes("Payment")
    )?.node;

    // 2. Check and activate Delivery Customization
    if (deliveryFn) {
      const dRes = await admin.graphql(`#graphql
        query checkDelivery {
          deliveryCustomizations(first: 10) {
            edges {
              node {
                id
                functionId
              }
            }
          }
        }
      `);
      const dJson: any = await dRes.json();
      const isDeliveryActive = dJson?.data?.deliveryCustomizations?.edges?.some(
        (e: any) => e.node.functionId === deliveryFn.id
      );

      if (!isDeliveryActive) {
        console.error(`[B2B_APP] Activating Delivery Customization for function ${deliveryFn.id}`);
        await admin.graphql(`#graphql
          mutation createDeliveryCustomization($input: DeliveryCustomizationInput!) {
            deliveryCustomizationCreate(deliveryCustomization: $input) {
              deliveryCustomization { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            input: {
              title: "B2B Delivery Customization",
              functionId: deliveryFn.id,
              enabled: true
            }
          }
        });
      }
    }

    // 3. Check and activate Payment Customization
    if (paymentFn) {
      const pRes = await admin.graphql(`#graphql
        query checkPayment {
          paymentCustomizations(first: 10) {
            edges {
              node {
                id
                functionId
              }
            }
          }
        }
      `);
      const pJson: any = await pRes.json();
      const isPaymentActive = pJson?.data?.paymentCustomizations?.edges?.some(
        (e: any) => e.node.functionId === paymentFn.id
      );

      if (!isPaymentActive) {
        console.error(`[B2B_APP] Activating Payment Customization for function ${paymentFn.id}`);
        await admin.graphql(`#graphql
          mutation createPaymentCustomization($input: PaymentCustomizationInput!) {
            paymentCustomizationCreate(paymentCustomization: $input) {
              paymentCustomization { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            input: {
              title: "B2B Payment Customization",
              functionId: paymentFn.id,
              enabled: true
            }
          }
        });
      }
    }
  } catch (error) {
    console.error("[B2B_APP] Error ensuring extensions are activated:", error);
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "saveCheckoutRule") {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const ruleType = formData.get("ruleType") as string;
    const customerTag = formData.get("customerTag") as string;
    const matchType = formData.get("matchType") as string;
    const conditions = formData.get("conditions") as string;
    const targetMethods = formData.get("targetMethods") as string;
    const errorMessage = formData.get("errorMessage") as string;
    const active = formData.get("active") === "true";

    const data = {
      name,
      customerTag,
      matchType,
      conditions,
      targetMethods: targetMethods || "",
      errorMessage: errorMessage || "",
      status: active ? "active" : "inactive",
      type: ruleType, 
      shopId: session.shop
    };

    if (id === "new") {
      const usage = await checkUsage(session.shop);
      if (usage.isLimitReached) {
        return { error: `Storage Limit Exceeded!` };
      }
      await db.checkoutRule.create({ data });
    } else {
      await db.checkoutRule.update({ where: { id }, data });
    }

    // SYNC to Metafields after save
    await syncRulesToMetafields(admin, session.shop, ruleType);

  } else if (actionType === "deleteCheckoutRule") {
    const id = formData.get("id") as string;
    const rule = await db.checkoutRule.findUnique({ where: { id } });
    if (rule) {
        await db.checkoutRule.delete({ where: { id } });
        await syncRulesToMetafields(admin, session.shop, rule.type);
    }
  }

  return { success: true };
};

async function syncRulesToMetafields(admin: any, shopDomain: string, ruleType: string) {
    const allRules = await db.checkoutRule.findMany({
        where: { shopId: shopDomain, type: ruleType, status: "active" }
    });

    let key = "";
    if (ruleType === "HIDE_SHIPPING") key = "shipping_rules";
    else if (ruleType === "HIDE_PAYMENT") key = "payment_rules";
    else return;

    // 1. Get Shop GID
    const shopInfoRes = await admin.graphql(`#graphql
        query {
            shop { id }
        }
    `);
    const shopInfoJson: any = await shopInfoRes.json();
    const shopGid: string = shopInfoJson.data?.shop?.id;

    if (!shopGid) {
        console.error("[CHECKOUT_RULES_SYNC] Could not retrieve shop GID.");
        return;
    }

    const metafieldValue = JSON.stringify(allRules.map(r => ({
        id: r.id,
        name: r.name,
        matchType: r.matchType,
        conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions,
        targetMethods: r.targetMethods,
        customerTag: r.customerTag,
        status: r.status
    })));

    await admin.graphql(`#graphql
        mutation setShopMetafield($input: MetafieldsSetInput!) {
            metafieldsSet(metafields: [$input]) {
                userErrors { field message }
            }
        }
    `, {
        variables: {
            input: {
                namespace: "b2b_app",
                key: key,
                type: "json",
                value: metafieldValue,
                ownerId: shopGid
            }
        }
    });

    console.error(`[CHECKOUT_RULES_SYNC] Synced ${allRules.length} ${ruleType} rules to ${key}`);
}

export default function CheckoutRulesPage() {
  const { rules, usage, uniqueTags } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const ruleId = searchParams.get("ruleId");
  const view = searchParams.get("view"); // 'shipping', 'payment', 'validation'
  const isEditing = !!ruleId;

  // Form State
  const [name, setName] = useState("");
  const [customerTag, setCustomerTag] = useState("ALL");
  const [matchType, setMatchType] = useState("ANY");
  const [conditions, setConditions] = useState<any[]>([]);
  const [targetMode, setTargetMode] = useState("all");
  const [specificMethods, setSpecificMethods] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (ruleId && ruleId !== "new") {
      const rule = rules.find(r => r.id === ruleId);
      if (rule) {
        setName(rule.name);
        setCustomerTag(rule.customerTag ?? "ALL");
        setMatchType(rule.matchType || "ANY");
        setErrorMessage(rule.errorMessage || "");
        setActive(rule.status === "active");
        
        try {
            const conds = typeof rule.conditions === "string" ? JSON.parse(rule.conditions) : (rule.conditions || []);
            setConditions(Array.isArray(conds) ? conds : []);
        } catch(e) { setConditions([]); }

        if (rule.targetMethods === "all_paid" || rule.targetMethods === "all_payment") {
            setTargetMode("all_paid");
        } else if (rule.targetMethods && rule.targetMethods !== "all") {
            setTargetMode("specific");
            setSpecificMethods(rule.targetMethods);
        } else {
            setTargetMode("all");
        }
      }
    } else {
      setName("");
      setCustomerTag("ALL");
      setMatchType("ANY");
      setErrorMessage("");
      setActive(true);
      setConditions([]);
      setTargetMode("all");
      setSpecificMethods("");
    }
  }, [ruleId, rules]);

  const handleSave = () => {
    let finalTarget = targetMode === "specific" ? specificMethods : (view === "shipping" ? "all_paid" : "all_payment");
    if (view === "validation") finalTarget = "";

    fetcher.submit({
      actionType: "saveCheckoutRule",
      id: ruleId || "new",
      name,
      ruleType: view === "shipping" ? "HIDE_SHIPPING" : (view === "payment" ? "HIDE_PAYMENT" : "CHECKOUT_VALIDATION"),
      customerTag,
      matchType,
      conditions: JSON.stringify(conditions),
      targetMethods: finalTarget,
      errorMessage,
      active: active.toString()
    }, { method: "POST" });
    
    shopify.toast.show("Rule saved successfully");
    const next = new URLSearchParams(searchParams);
    next.delete("ruleId");
    setSearchParams(next);
  };

  const addCondition = () => {
      setConditions([...conditions, { type: "total_qty", operator: "gte", value: 1 }]);
  };

  const removeCondition = (index: number) => {
      setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, key: string, val: any) => {
      const newConds = [...conditions];
      newConds[index] = { ...newConds[index], [key]: val };
      setConditions(newConds);
  };

  if (isEditing) {
    return (
        <>
          <Breadcrumbs items={[{ label: "Checkout Rules", url: "/app/checkout-rules" }, { label: view === "shipping" ? "Hide Shipping" : "Hide Payment" }, { label: isEditing && ruleId !== "new" ? name : "New Rule" }]} />
          <s-page heading={isEditing && ruleId !== "new" ? `Edit Rule: ${name}` : `Create ${view === "shipping" ? "Hide Shipping" : "Hide Payment"} Rule`} back-action-url={`/app/checkout-rules?view=${view}`}>
            <div style={{ maxWidth: "800px", margin: "0 auto" }}>
              <div style={cardStyle}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Rule Label</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. VIP Shipping Rule" />
                  <p style={{ fontSize: "0.8em", color: "#666", marginTop: "4px" }}>A descriptive name for this rule</p>
                </div>
              </div>

              <div style={cardStyle}>
                <h3 style={{ margin: "0 0 15px 0", fontSize: "1em" }}>Conditions</h3>
                <p style={{ fontSize: "0.9em", color: "#666", marginBottom: "15px" }}>Add a condition that must be met for this rule to apply.</p>
                
                <div style={{ marginBottom: "15px" }}>
                    <select value={matchType} onChange={e => setMatchType(e.target.value)} style={inputStyle}>
                        <option value="ANY">Any one condition must be met</option>
                        <option value="ALL">All conditions must be met</option>
                    </select>
                </div>

                {conditions.map((cond, idx) => (
                    <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px", padding: "10px", background: "#f9f9f9", borderRadius: "8px" }}>
                        <select value={cond.type} onChange={e => updateCondition(idx, 'type', e.target.value)} style={{ ...inputStyle, width: "150px" }}>
                            <option value="total_qty">Cart Total Quantity</option>
                            <option value="total_amount">Cart Total Amount</option>
                            <option value="customer_tag">Customer Tag</option>
                        </select>
                        <select value={cond.operator} onChange={e => updateCondition(idx, 'operator', e.target.value)} style={{ ...inputStyle, width: "180px" }}>
                            {cond.type === "customer_tag" ? (
                                <>
                                    <option value="contains">Contains</option>
                                    <option value="not_contains">Does not contain</option>
                                </>
                            ) : (
                                <>
                                    <option value="gte">Greater than or equals</option>
                                    <option value="lte">Less than or equals</option>
                                </>
                            )}
                        </select>
                        <input 
                            type={cond.type === "customer_tag" ? "text" : "number"} 
                            value={cond.value} 
                            onChange={e => updateCondition(idx, 'value', e.target.value)} 
                            style={inputStyle} 
                            placeholder="Enter value" 
                        />
                        <s-button variant="secondary" onClick={() => removeCondition(idx)}>Remove</s-button>
                    </div>
                ))}

                <s-button variant="secondary" onClick={addCondition}>+ Add New Condition</s-button>
              </div>

              <div style={cardStyle}>
                <h3 style={{ margin: "0 0 15px 0", fontSize: "1em" }}>Apply to {view === "shipping" ? "Shipping" : "Payment"} Method</h3>
                <div style={formGroupStyle}>
                    <select value={targetMode} onChange={e => setTargetMode(e.target.value)} style={inputStyle}>
                        <option value="all">Hide All {view === "shipping" ? "Paid " : ""}Methods</option>
                        <option value="specific">Hide Specific Methods</option>
                    </select>
                </div>
                {targetMode === "specific" && (
                    <div style={formGroupStyle}>
                        <input 
                            type="text" 
                            value={specificMethods} 
                            onChange={e => setSpecificMethods(e.target.value)} 
                            style={inputStyle} 
                            placeholder="e.g. Express Shipping, COD" 
                        />
                        <p style={{ fontSize: "0.8em", color: "#666", marginTop: "4px" }}>Type method names separated by comma</p>
                    </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "20px" }}>
                <s-button variant="secondary" onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("ruleId");
                    setSearchParams(next);
                }}>Cancel</s-button>
                <s-button variant="primary" onClick={handleSave}>Save Rule</s-button>
              </div>
            </div>
          </s-page>
        </>
    );
  }

  if (view) {
      const currentRules = rules.filter(r => r.type === (view === "shipping" ? "HIDE_SHIPPING" : (view === "payment" ? "HIDE_PAYMENT" : "CHECKOUT_VALIDATION")));
      return (
          <>
            <Breadcrumbs items={[{ label: "Checkout Rules", url: "/app/checkout-rules" }, { label: view === "shipping" ? "Shipping Rules" : "Payment Rules" }]} />
            <s-page heading={`${view === "shipping" ? "Shipping" : "Payment"} Customization Rules`} back-action-url="/app/checkout-rules">
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "20px" }}>
                    <s-button variant="primary" onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set("ruleId", "new");
                        setSearchParams(next);
                    }}>+ Create Rule</s-button>
                </div>
                <div style={cardStyle}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ textAlign: "left", background: "#f9f9f9", borderBottom: "1px solid #eee" }}>
                                <th style={thStyle}>Rule Name</th>
                                <th style={thStyle}>Conditions</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentRules.length === 0 ? (
                                <tr><td colSpan={4} style={{ padding: "40px", textAlign: "center", color: "#888" }}>No rules found.</td></tr>
                            ) : currentRules.map(rule => (
                                <tr key={rule.id} style={{ borderBottom: "1px solid #eee" }}>
                                    <td style={tdStyle}><strong>{rule.name}</strong></td>
                                    <td style={tdStyle}>
                                        {rule.matchType === "ALL" ? "All of: " : "Any of: "}
                                        {JSON.parse(rule.conditions || "[]").length} conditions
                                    </td>
                                    <td style={tdStyle}>{rule.status === "active" ? "✅ Active" : "❌ Inactive"}</td>
                                    <td style={tdStyle}>
                                        <s-button variant="secondary" onClick={() => {
                                            const next = new URLSearchParams(searchParams);
                                            next.set("ruleId", rule.id);
                                            setSearchParams(next);
                                        }}>Edit</s-button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </s-page>
          </>
      );
  }

  // Dashboard View
  return (
    <>
      <Breadcrumbs items={[{ label: "Checkout Rules" }]} />
      <s-page heading="Checkout Rules & Validation" back-action-url="/app">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "20px" }}>
            <div style={cardStyle}>
                <h2 style={{ margin: "0 0 10px 0", fontSize: "1.2em" }}>Hide Shipping Methods</h2>
                <p style={{ color: "#666", marginBottom: "20px", minHeight: "60px" }}>Configure rules to hide specific shipping methods based on customer segments, tags, or other conditions.</p>
                <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                    <s-button variant="primary" onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set("view", "shipping");
                        setSearchParams(next);
                    }}>+ Manage Rules</s-button>
                    <Link to="#" style={{ color: "#005bd3", textDecoration: "none", fontSize: "0.9em" }}>View User Guide</Link>
                </div>
            </div>

            <div style={cardStyle}>
                <h2 style={{ margin: "0 0 10px 0", fontSize: "1.2em" }}>Hide Payment Methods</h2>
                <p style={{ color: "#666", marginBottom: "20px", minHeight: "60px" }}>Configure rules to hide specific payment methods based on customer segments, tags, or other conditions.</p>
                <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                    <s-button variant="primary" onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set("view", "payment");
                        setSearchParams(next);
                    }}>+ Manage Rules</s-button>
                    <Link to="#" style={{ color: "#005bd3", textDecoration: "none", fontSize: "0.9em" }}>View User Guide</Link>
                </div>
            </div>
        </div>
      </s-page>
    </>
  );
}

const cardStyle = {
    background: "white",
    padding: "25px",
    borderRadius: "12px",
    border: "1px solid #ddd",
    marginBottom: "20px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.02)"
};
const thStyle = { padding: "12px 15px", fontWeight: "650", fontSize: "0.9em" };
const tdStyle = { padding: "12px 15px", fontSize: "0.95em" };
const formGroupStyle = { marginBottom: "20px" };
const labelStyle = { display: "block", marginBottom: "8px", fontWeight: "bold", fontSize: "0.9em" };
const inputStyle = { 
    width: "100%", 
    padding: "10px", 
    borderRadius: "8px", 
    border: "1px solid #ccc", 
    boxSizing: "border-box" as const,
    fontSize: "0.95em"
};
