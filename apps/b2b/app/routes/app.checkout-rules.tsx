import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation } from "react-router";
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
      where: { shopId: session.shop, type: "CHECKOUT_VALIDATION" },
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
  return { rules, usage, uniqueTags };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "saveCheckoutRule") {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const customerTag = formData.get("customerTag") as string;
    const conditions = formData.get("conditions") as string; // JSON string
    const errorMessage = formData.get("errorMessage") as string;
    const active = formData.get("active") === "true";

    const data = {
      name,
      customerTag,
      conditions: conditions ? conditions : "{}", // Save as string
      errorMessage,
      status: active ? "active" : "inactive",
      type: "CHECKOUT_VALIDATION", // Now exists in schema
      shopId: session.shop
    };

    if (id === "new") {
      const usage = await checkUsage(session.shop);
      if (usage.isLimitReached) {
        return { error: `Storage Limit Exceeded! You only have ${usage.maxRowLimit} rule slots.` };
      }
      await db.checkoutRule.create({ data });
    } else {
      await db.checkoutRule.update({ where: { id }, data });
    }
  } else if (actionType === "deleteCheckoutRule") {
    const id = formData.get("id") as string;
    await db.checkoutRule.delete({ where: { id } });
  }

  return { success: true };
};

export default function CheckoutRulesPage() {
  const { rules, usage, uniqueTags } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const ruleId = searchParams.get("ruleId");
  const isEditing = !!ruleId;

  const [name, setName] = useState("");
  const [customerTag, setCustomerTag] = useState("ALL");
  const [errorMessage, setErrorMessage] = useState("Your order does not meet our B2B requirements.");
  const [active, setActive] = useState(true);
  const [minQty, setMinQty] = useState("1");
  const [minAmount, setMinAmount] = useState("0");

  useEffect(() => {
    if (ruleId && ruleId !== "new") {
      const rule = rules.find(r => r.id === ruleId);
      if (rule) {
        setName(rule.name);
        setCustomerTag(rule.customerTag ?? "");
        setErrorMessage(rule.errorMessage || "");
        setActive(rule.status === "active");
        const conds = typeof rule.conditions === "string" ? JSON.parse(rule.conditions) : (rule.conditions || {});
        setMinQty(conds?.minTotalQty?.toString() || "1");
        setMinAmount(conds?.minTotalAmount?.toString() || "0");
      }
    } else {
      setName("");
      setCustomerTag("ALL");
      setErrorMessage("Your order does not meet our B2B requirements.");
      setActive(true);
      setMinQty("1");
      setMinAmount("0");
    }
  }, [ruleId, rules]);

  const handleSave = () => {
    const conditions = {
      minTotalQty: parseInt(minQty),
      minTotalAmount: parseFloat(minAmount)
    };
    fetcher.submit({
      actionType: "saveCheckoutRule",
      id: ruleId || "new",
      name,
      customerTag,
      conditions: JSON.stringify(conditions),
      errorMessage,
      active: active.toString()
    }, { method: "POST" });
    shopify.toast.show("Checkout rule saved");
    const next = new URLSearchParams(searchParams);
    next.delete("ruleId");
    setSearchParams(next);
  };

  const renderUsageBanner = () => {
    if (!usage) return null;
    if (usage.isLimitReached) {
       return (
         <div style={{ marginBottom: "20px" }}>
           <Banner tone="critical" title="Storage Limit Reached">
             You have used all {usage.maxRowLimit} allowed rules ({usage.currentGb} GB). You cannot add new rules until you <a href="/app/pricing"><strong>upgrade your plan</strong></a>.
           </Banner>
         </div>
       );
    }
    if (usage.isWarning) {
       return (
         <div style={{ marginBottom: "20px" }}>
           <Banner tone="warning" title="Storage Limit Approaching">
             You have used {usage.totalRows} out of {usage.maxRowLimit} allowed rules ({usage.currentGb} GB). <a href="/app/pricing"><strong>Upgrade your plan</strong></a> soon to continue growing your B2B offerings without interruption.
           </Banner>
         </div>
       );
    }
    return null;
  };

  const renderList = () => (
    <>
      <Breadcrumbs items={[{ label: "Checkout Rules" }]} />
      <s-page heading="Checkout Rules & Validation" back-action-url="/app">
        {renderUsageBanner()}
        <div style={{ marginBottom: "20px", textAlign: "right" }}>
          <s-button variant="primary" disabled={usage?.isLimitReached} onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set("ruleId", "new");
            setSearchParams(next);
          }}>+ Create Rule</s-button>
        </div>

        <div style={{ background: "white", borderRadius: "12px", border: "1px solid #ddd", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#f9f9f9" }}>
                <th style={thStyle}>Rule Name</th>
                <th style={thStyle}>Target Tag</th>
                <th style={thStyle}>Restrictions</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr><td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#888", padding: "40px" }}>No validation rules created yet.</td></tr>
              ) : rules.map(rule => (
                <tr key={rule.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={tdStyle}><strong>{rule.name}</strong></td>
                  <td style={tdStyle}><span style={tagStyle}>{rule.customerTag}</span></td>
                  <td style={tdStyle}>
                    Min Qty: {(typeof rule.conditions === "string" ? JSON.parse(rule.conditions) : (rule.conditions || {}))?.minTotalQty}, 
                    Min Amount: ${(typeof rule.conditions === "string" ? JSON.parse(rule.conditions) : (rule.conditions || {}))?.minTotalAmount}
                  </td>
                  <td style={tdStyle}>{rule.status === "active" ? "✅ Enabled" : "❌ Disabled"}</td>
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

  const renderForm = () => (
    <>
      <Breadcrumbs items={[{ label: "Checkout Rules", url: "/app/checkout-rules" }, { label: isEditing ? name || "Edit Rule" : "New Rule" }]} />
      <s-page heading={isEditing ? `Edit Rule: ${name || "Untitled"}` : "Create Checkout Validation Rule"} back-action-url="/app/checkout-rules">
        {renderUsageBanner()}
        <div style={{ maxWidth: "600px", margin: "0 auto", background: "white", padding: "30px", borderRadius: "12px", border: "1px solid #ddd" }}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Rule Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. VIP Order Requirements" />
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Target Customer Tag</label>
            <TagCombobox
              value={customerTag || "ALL"}
              onChange={(val) => setCustomerTag(val)}
              availableTags={uniqueTags?.length ? uniqueTags : ["ALL"]}
            />
          </div>
          
          <div style={{ border: "1px solid #eee", padding: "20px", borderRadius: "8px", background: "#fcfcfc", marginBottom: "20px" }}>
            <h3 style={{ marginTop: 0, fontSize: "1em", marginBottom: "15px" }}>Validation Conditions</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Min Total Quantity</label>
                <input type="number" value={minQty} onChange={e => setMinQty(e.target.value)} style={inputStyle} />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Min Order Amount ($)</label>
                <input type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} style={inputStyle} />
              </div>
            </div>
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Error Message (shown at checkout)</label>
            <textarea value={errorMessage} onChange={e => setErrorMessage(e.target.value)} style={{ ...inputStyle, minHeight: "80px" }} />
          </div>

          <div style={{ ...formGroupStyle, display: "flex", alignItems: "center", gap: "10px" }}>
             <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} id="active" />
             <label htmlFor="active" style={{ cursor: "pointer" }}>Enable validation</label>
          </div>
          
          <div style={{ marginTop: "30px", display: "flex", justifyContent: "space-between" }}>
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

  return isEditing ? renderForm() : renderList();
}

const thStyle = { padding: "12px 15px" };
const tdStyle = { padding: "12px 15px" };
const tagStyle = { background: "#eee", padding: "4px 8px", borderRadius: "4px", fontSize: "0.85em", fontWeight: "bold" };
const formGroupStyle = { marginBottom: "20px" };
const labelStyle = { display: "block", marginBottom: "8px", fontWeight: "bold", fontSize: "0.9em" };
const inputStyle = { width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #ccc", boxSizing: "border-box" as const };
