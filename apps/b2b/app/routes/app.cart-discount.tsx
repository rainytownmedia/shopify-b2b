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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rules = await db.cartDiscount.findMany({
    where: { shopId: session.shop },
    orderBy: { updatedAt: 'desc' }
  });
  const usage = await checkUsage(session.shop);
  return { rules, usage };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "saveCartDiscount") {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const customerTag = formData.get("customerTag") as string;
    const minSubtotal = parseFloat(formData.get("minOrderValue") as string);
    const discountType = formData.get("discountType") as string;
    const value = parseFloat(formData.get("discountValue") as string);
    const status = formData.get("active") === "true" ? "active" : "inactive";

    const data = {
      name,
      customerTag,
      minSubtotal,
      discountType,
      value,
      status,
      shopId: session.shop
    };

    if (id === "new") {
      const usage = await checkUsage(session.shop);
      if (usage.isLimitReached) {
        return { error: `Storage Limit Exceeded! You only have ${usage.maxRowLimit} rule slots.` };
      }
      await db.cartDiscount.create({ data });
    } else {
      await db.cartDiscount.update({ where: { id }, data });
    }
  } else if (actionType === "deleteCartDiscount") {
    const id = formData.get("id") as string;
    await db.cartDiscount.delete({ where: { id } });
  }

  return { success: true };
};

export default function CartDiscountPage() {
  const { rules, usage } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigation = useNavigation();

  const ruleId = searchParams.get("ruleId");
  const isEditing = !!ruleId;

  const [name, setName] = useState("");
  const [customerTag, setCustomerTag] = useState("");
  const [minOrderValue, setMinOrderValue] = useState("0");
  const [discountType, setDiscountType] = useState("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState("0");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (ruleId && ruleId !== "new") {
      const rule = rules.find(r => r.id === ruleId);
      if (rule) {
        setName(rule.name);
        setCustomerTag(rule.customerTag ?? "");
        setMinOrderValue((rule.minSubtotal ?? 0).toString());
        setDiscountType(rule.discountType);
        setDiscountValue(rule.value.toString());
        setActive(rule.status === "active");
      }
    } else {
      setName("");
      setCustomerTag("");
      setMinOrderValue("0");
      setDiscountType("PERCENTAGE");
      setDiscountValue("0");
      setActive(true);
    }
  }, [ruleId, rules]);

  const handleSave = () => {
    fetcher.submit({
      actionType: "saveCartDiscount",
      id: ruleId || "new",
      name,
      customerTag,
      minOrderValue,
      discountType,
      discountValue,
      active: active.toString()
    }, { method: "POST" });
    shopify.toast.show("Discount rule saved");
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
      <Breadcrumbs items={[{ label: "Cart Discount" }]} />
      <s-page heading="Cart Discount Rules" back-action-url="/app">
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
                <th style={thStyle}>Condition</th>
                <th style={thStyle}>Discount</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#888", padding: "40px" }}>No rules created yet.</td></tr>
              ) : rules.map(rule => (
                <tr key={rule.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={tdStyle}><strong>{rule.name}</strong></td>
                  <td style={tdStyle}><span style={tagStyle}>{rule.customerTag}</span></td>
                  <td style={tdStyle}>Min Order: ${rule.minSubtotal ?? 0}</td>
                  <td style={tdStyle}>{rule.value}{rule.discountType === "PERCENTAGE" ? "% OFF" : " Fixed"}</td>
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

  const renderForm = () => (
    <>
      <Breadcrumbs items={[{ label: "Cart Discount", url: "/app/cart-discount" }, { label: isEditing ? name || "Edit Rule" : "New Rule" }]} />
      <s-page heading={isEditing ? `Edit Rule: ${name || "Untitled"}` : "Create Cart Discount Rule"} back-action-url="/app/cart-discount">
        {renderUsageBanner()}
        <div style={{ maxWidth: "600px", margin: "0 auto", background: "white", padding: "30px", borderRadius: "12px", border: "1px solid #ddd" }}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Rule Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. VIP 10% Off Cart" />
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Target Customer Tag</label>
            <input type="text" value={customerTag} onChange={e => setCustomerTag(e.target.value)} style={inputStyle} placeholder="e.g. VIP" />
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Minimum Order Value ($)</label>
            <input type="number" value={minOrderValue} onChange={e => setMinOrderValue(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Discount Type</label>
              <select value={discountType} onChange={e => setDiscountType(e.target.value)} style={inputStyle}>
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FIXED_AMOUNT">Fixed Amount ($)</option>
              </select>
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Value</label>
              <input type="number" value={discountValue} onChange={e => setDiscountValue(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ ...formGroupStyle, display: "flex", alignItems: "center", gap: "10px" }}>
             <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} id="active" />
             <label htmlFor="active" style={{ cursor: "pointer" }}>Currently active</label>
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
