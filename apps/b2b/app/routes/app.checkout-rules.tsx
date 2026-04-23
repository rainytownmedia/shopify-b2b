import { useState, useEffect, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkUsage } from "../utils/quota.server";
import { getComboboxTagOptions } from "../utils/customer-tags.server";
import React from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Banner } from "@shopify/polaris";
import { TagCombobox } from "../components/TagCombobox";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [rules, usage, uniqueTags] = await Promise.all([
    db.checkoutRule.findMany({
      where: { shopId: session.shop },
      orderBy: { updatedAt: 'desc' }
    }),
    checkUsage(session.shop),
    getComboboxTagOptions(session.shop)
  ]);
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
  } else if (actionType === "bulkActivate") {
    const ids = (formData.get("ids") as string).split(",").filter(Boolean);
    await db.checkoutRule.updateMany({ where: { id: { in: ids } }, data: { status: "active" } });
    const firstRule = await db.checkoutRule.findFirst({ where: { id: { in: ids } } });
    if (firstRule) await syncRulesToMetafields(admin, session.shop, firstRule.type);
  } else if (actionType === "bulkDeactivate") {
    const ids = (formData.get("ids") as string).split(",").filter(Boolean);
    await db.checkoutRule.updateMany({ where: { id: { in: ids } }, data: { status: "inactive" } });
    const firstRule = await db.checkoutRule.findFirst({ where: { id: { in: ids } } });
    if (firstRule) await syncRulesToMetafields(admin, session.shop, firstRule.type);
  } else if (actionType === "bulkDelete") {
    const ids = (formData.get("ids") as string).split(",").filter(Boolean);
    const firstRule = await db.checkoutRule.findFirst({ where: { id: { in: ids } } });
    await db.checkoutRule.deleteMany({ where: { id: { in: ids } } });
    if (firstRule) await syncRulesToMetafields(admin, session.shop, firstRule.type);
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
  const [specificMethods, setSpecificMethods] = useState<string[]>([]);
  const [methodInput, setMethodInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [active, setActive] = useState(true);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);

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
            setSpecificMethods([]);
        } else if (rule.targetMethods && rule.targetMethods !== "all") {
            setTargetMode("specific");
            setSpecificMethods(rule.targetMethods.split(",").map((m: string) => m.trim()).filter(Boolean));
        } else {
            setTargetMode("all");
            setSpecificMethods([]);
        }
        setMethodInput("");
      }
    } else {
      setName("");
      setCustomerTag("ALL");
      setMatchType("ANY");
      setErrorMessage("");
      setActive(true);
      setConditions([]);
      setTargetMode("all");
      setSpecificMethods([]);
      setMethodInput("");
    }
  }, [ruleId, rules]);

  const handleSave = () => {
    let finalTarget = targetMode === "specific" ? specificMethods.join(",") : (view === "shipping" ? "all_paid" : "all_payment");
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
          <Breadcrumbs items={[
            { label: "Checkout Rules", url: "/app/checkout-rules" },
            { label: view === "shipping" ? "Hide Shipping" : "Hide Payment", url: `/app/checkout-rules?view=${view}` },
            { label: ruleId !== "new" ? name : "New Rule" }
          ]} />
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
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap" as const,
                                gap: "8px",
                                alignItems: "center",
                                minHeight: "44px",
                                padding: "8px 10px",
                                border: "1px solid #ccc",
                                borderRadius: "8px",
                                background: "white",
                                cursor: "text"
                            }}
                            onClick={() => (document.getElementById("method-tag-input") as HTMLInputElement)?.focus()}
                        >
                            {specificMethods.map((method, idx) => (
                                <span
                                    key={idx}
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "4px",
                                        background: "#f1f1f1",
                                        border: "1px solid #ddd",
                                        borderRadius: "6px",
                                        padding: "2px 8px",
                                        fontSize: "0.9em",
                                        fontWeight: 500,
                                        color: "#333"
                                    }}
                                >
                                    {method}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setSpecificMethods(specificMethods.filter((_, i) => i !== idx)); }}
                                        style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "#666", fontSize: "1em", lineHeight: 1 }}
                                    >×</button>
                                </span>
                            ))}
                            <input
                                id="method-tag-input"
                                type="text"
                                value={methodInput}
                                onChange={e => setMethodInput(e.target.value)}
                                onKeyDown={e => {
                                    if ((e.key === "Enter" || e.key === ",") && methodInput.trim()) {
                                        e.preventDefault();
                                        const val = methodInput.trim().replace(/,+$/, "");
                                        if (val && !specificMethods.includes(val)) {
                                            setSpecificMethods([...specificMethods, val]);
                                        }
                                        setMethodInput("");
                                    } else if (e.key === "Backspace" && !methodInput && specificMethods.length > 0) {
                                        setSpecificMethods(specificMethods.slice(0, -1));
                                    }
                                }}
                                placeholder={specificMethods.length === 0 ? "Type method name and press Enter" : ""}
                                style={{
                                    border: "none",
                                    outline: "none",
                                    flex: 1,
                                    minWidth: "160px",
                                    fontSize: "0.95em",
                                    padding: "2px 0",
                                    background: "transparent"
                                }}
                            />
                        </div>
                        <p style={{ fontSize: "0.8em", color: "#888", marginTop: "4px" }}>Type method name and press Enter to add. Press Backspace to remove last tag.</p>
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
      const allSelected = currentRules.length > 0 && currentRules.every(r => selectedRules.includes(r.id));

      const handleToggleAll = () => {
        if (allSelected) {
          setSelectedRules([]);
        } else {
          setSelectedRules(currentRules.map(r => r.id));
        }
      };

      const handleBulkAction = (actionType: string) => {
        if (selectedRules.length === 0) return;
        if (actionType === "bulkDelete" && !confirm(`Delete ${selectedRules.length} selected rule(s)?`)) return;
        fetcher.submit({ actionType, ids: selectedRules.join(",") }, { method: "POST" });
        setSelectedRules([]);
        shopify.toast.show(actionType === "bulkDelete" ? "Rules deleted" : actionType === "bulkActivate" ? "Rules activated" : "Rules deactivated");
      };

      return (
          <>
            <Breadcrumbs items={[{ label: "Checkout Rules", url: "/app/checkout-rules" }, { label: view === "shipping" ? "Shipping Rules" : "Payment Rules" }]} />
            <s-page heading={`${view === "shipping" ? "Shipping" : "Payment"} Customization Rules`} back-action-url="/app/checkout-rules">
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                    <button
                        onClick={() => handleBulkAction("bulkActivate")}
                        disabled={selectedRules.length === 0}
                        style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #ccc", background: selectedRules.length > 0 ? "white" : "#f5f5f5", cursor: selectedRules.length > 0 ? "pointer" : "not-allowed", fontSize: "0.9em", color: selectedRules.length > 0 ? "#333" : "#aaa" }}
                    >Activate</button>
                    <button
                        onClick={() => handleBulkAction("bulkDeactivate")}
                        disabled={selectedRules.length === 0}
                        style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #ccc", background: selectedRules.length > 0 ? "white" : "#f5f5f5", cursor: selectedRules.length > 0 ? "pointer" : "not-allowed", fontSize: "0.9em", color: selectedRules.length > 0 ? "#333" : "#aaa" }}
                    >Deactivate</button>
                    <button
                        onClick={() => handleBulkAction("bulkDelete")}
                        disabled={selectedRules.length === 0}
                        style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #ccc", background: selectedRules.length > 0 ? "#fff0f0" : "#f5f5f5", cursor: selectedRules.length > 0 ? "pointer" : "not-allowed", fontSize: "0.9em", color: selectedRules.length > 0 ? "#c00" : "#aaa" }}
                    >Delete</button>
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
                                <th style={{ ...thStyle, width: "40px" }}>
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={handleToggleAll}
                                        style={{ cursor: "pointer", width: "16px", height: "16px" }}
                                    />
                                </th>
                                <th style={thStyle}>Rule Name</th>
                                <th style={thStyle}>Conditions</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentRules.length === 0 ? (
                                <tr><td colSpan={5} style={{ padding: "40px", textAlign: "center", color: "#888" }}>No rules found.</td></tr>
                            ) : currentRules.map(rule => (
                                <tr key={rule.id} style={{ borderBottom: "1px solid #eee", background: selectedRules.includes(rule.id) ? "#f0f7ff" : "transparent" }}>
                                    <td style={{ ...tdStyle, width: "40px" }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedRules.includes(rule.id)}
                                            onChange={e => {
                                                if (e.target.checked) setSelectedRules([...selectedRules, rule.id]);
                                                else setSelectedRules(selectedRules.filter(id => id !== rule.id));
                                            }}
                                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                                        />
                                    </td>
                                    <td style={tdStyle}><strong>{rule.name}</strong></td>
                                    <td style={tdStyle}>
                                        {rule.matchType === "ALL" ? "All of: " : "Any of: "}
                                        {JSON.parse(rule.conditions || "[]").length} conditions
                                    </td>
                                    <td style={tdStyle}>
                                        <span style={{
                                            display: "inline-block",
                                            padding: "3px 10px",
                                            borderRadius: "20px",
                                            fontSize: "0.82em",
                                            fontWeight: 600,
                                            background: rule.status === "active" ? "#e6f9f0" : "#f5f5f5",
                                            color: rule.status === "active" ? "#1a7a4a" : "#888",
                                            border: `1px solid ${rule.status === "active" ? "#b2e5cc" : "#ddd"}`
                                        }}>
                                            {rule.status === "active" ? "ACTIVE" : "INACTIVE"}
                                        </span>
                                    </td>
                                    <td style={tdStyle}>
                                        <s-button variant="secondary" onClick={() => {
                                            const next = new URLSearchParams(searchParams);
                                            next.set("ruleId", rule.id);
                                            setSearchParams(next);
                                        }}>✏️ Edit</s-button>
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
