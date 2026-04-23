import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { TagCombobox } from "../components/TagCombobox";
import { getComboboxTagOptions } from "../utils/customer-tags.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [limits, uniqueTags] = await Promise.all([
    db.orderLimit.findMany({
      where: { shopId: session.shop },
      orderBy: { createdAt: "desc" },
    }),
    getComboboxTagOptions(session.shop),
  ]);
  return { limits, uniqueTags };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "DELETE") {
    const id = formData.get("id") as string;
    await db.orderLimit.delete({ where: { id, shopId: session.shop } });
    return Response.json({ success: true });
  }

  const id = formData.get("id") as string | null;
  const label = formData.get("label") as string;
  const status = formData.get("status") as string;
  const customerType = formData.get("customerType") as string;
  const customerTag = formData.get("customerTag") as string | null;
  const matchType = formData.get("matchType") as string;
  const conditions = formData.get("conditions") as string;

  if (id) {
    await db.orderLimit.update({
      where: { id, shopId: session.shop },
      data: { label, status, customerType, customerTag, matchType, conditions },
    });
  } else {
    await db.orderLimit.create({
      data: { shopId: session.shop, label, status, customerType, customerTag, matchType, conditions },
    });
  }
  return Response.json({ success: true });
};

type Condition = { target: string; type: string; min: string; max: string };

function OrderLimitEditor({ rule, onSave, onDiscard, isSaving, availableTags }: any) {
  const [label, setLabel] = useState(rule?.label || "");
  const [status, setStatus] = useState(rule?.status || "enabled");
  const [customerType, setCustomerType] = useState(rule?.customerType || "all");
  const [customerTag, setCustomerTag] = useState(rule?.customerTag || "");
  const [matchType, setMatchType] = useState(rule?.matchType || "ANY");
  const [conditions, setConditions] = useState<Condition[]>(
    rule?.conditions ? JSON.parse(rule.conditions) : [{ target: "Cart", type: "Total Quantity", min: "", max: "" }]
  );

  const addCondition = () => setConditions([...conditions, { target: "Cart", type: "Total Quantity", min: "", max: "" }]);
  const removeCondition = (i: number) => setConditions(conditions.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, field: keyof Condition, val: string) => {
    const next = [...conditions]; next[i] = { ...next[i], [field]: val }; setConditions(next);
  };

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <button onClick={onDiscard} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1em", color: "#005bd3" }}>← Back</button>
        <h1 style={{ fontWeight: "bold", fontSize: "1.3em" }}>{rule ? "Edit Order Limit" : "Create Order Limit"}</h1>
        <div />
      </div>

      {/* Status */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <strong>Offer Status</strong>
          <span title="Enable or disable this limit rule" style={{ cursor: "help", color: "#6d7175" }}>ⓘ</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
          <label style={radioLabel}><input type="radio" name="status" checked={status === "enabled"} onChange={() => setStatus("enabled")} /> Enable</label>
          <label style={radioLabel}><input type="radio" name="status" checked={status === "disabled"} onChange={() => setStatus("disabled")} /> Disable</label>
        </div>
      </div>

      {/* Label */}
      <div style={cardStyle}>
        <label style={labelStyle}>Label *</label>
        <input style={inputStyle} value={label} onChange={e => setLabel(e.target.value)} placeholder="" />
        <p style={{ fontSize: "0.85em", color: "#6d7175", marginTop: "6px" }}>Name of this limit campaign which only you can see</p>
      </div>

      {/* Customer Tags */}
      <div style={cardStyle}>
        <strong style={labelStyle}>Customer Tags</strong>
        <p style={{ color: "#6d7175", fontSize: "0.9em", marginBottom: "14px" }}>Customer Type</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <label style={radioLabel}><input type="radio" name="ctype" checked={customerType === "all"} onChange={() => setCustomerType("all")} /> All Customers</label>
          <label style={radioLabel}><input type="radio" name="ctype" checked={customerType === "logged_in"} onChange={() => setCustomerType("logged_in")} /> Logged In Customers</label>
          <label style={radioLabel}><input type="radio" name="ctype" checked={customerType === "tagged"} onChange={() => setCustomerType("tagged")} /> Tagged Customers</label>
        </div>
        {customerType === "tagged" && (
          <div style={{ marginTop: "12px" }}>
            <TagCombobox
              value={customerTag}
              onChange={setCustomerTag}
              availableTags={availableTags?.length ? availableTags : ["ALL"]}
              placeholder="e.g. VIP, wholesale"
            />
          </div>
        )}
      </div>

      {/* Conditions */}
      <div style={cardStyle}>
        <strong style={labelStyle}>Conditions</strong>
        <p style={{ color: "#6d7175", fontSize: "0.9em", marginBottom: "14px" }}>Add a condition that must be met for the order discount to apply.</p>
        <select style={{ ...inputStyle, marginBottom: "20px" }} value={matchType} onChange={e => setMatchType(e.target.value)}>
          <option value="ANY">Any one condition must be met</option>
          <option value="ALL">All conditions must be met</option>
        </select>

        <div style={{ border: "1px solid #e1e1e1", borderRadius: "8px", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", background: "#f4f6f8", padding: "10px 14px", borderBottom: "1px solid #e1e1e1" }}>
            <span style={thText}>Target</span>
            <span style={thText}>Type</span>
            <span style={thText}>Minimum Value</span>
            <span style={thText}>Maximum Value</span>
            <span style={thText}>Actions</span>
          </div>
          {conditions.map((c, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: "10px", padding: "12px 14px", borderBottom: "1px solid #f4f6f8", alignItems: "center" }}>
              <span style={{ color: "#202223", fontWeight: "500" }}>Cart</span>
              <select style={{ ...inputStyle, marginTop: 0 }} value={c.type} onChange={e => updateCondition(i, "type", e.target.value)}>
                <option value="Total Quantity">Total Quantity</option>
                <option value="Total Amount">Total Amount</option>
              </select>
              <input type="number" style={{ ...inputStyle, marginTop: 0 }} placeholder="Min" value={c.min} onChange={e => updateCondition(i, "min", e.target.value)} />
              <input type="number" style={{ ...inputStyle, marginTop: 0 }} placeholder="Max" value={c.max} onChange={e => updateCondition(i, "max", e.target.value)} />
              <button onClick={() => removeCondition(i)} disabled={conditions.length === 1}
                style={{ background: "#202223", color: "white", border: "none", borderRadius: "6px", padding: "6px 12px", cursor: conditions.length === 1 ? "not-allowed" : "pointer", opacity: conditions.length === 1 ? 0.5 : 1, fontSize: "0.85em" }}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <button onClick={addCondition} style={{ marginTop: "12px", background: "#202223", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontWeight: "600" }}>
          Add New
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
        <button onClick={onDiscard} style={{ padding: "10px 20px", background: "white", border: "1px solid #c9cccf", borderRadius: "8px", cursor: "pointer" }}>Discard</button>
        <button onClick={() => onSave({ label, status, customerType, customerTag, matchType, conditions: JSON.stringify(conditions) })}
          disabled={isSaving || !label}
          style={{ padding: "10px 24px", background: "#202223", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600", opacity: !label ? 0.6 : 1 }}>
          {isSaving ? "Saving..." : rule ? "Save Changes" : "Create Rule"}
        </button>
      </div>
    </div>
  );
}

export default function OrderLimitPage() {
  const { limits, uniqueTags } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();

  const mode = searchParams.get("mode");
  const editingRule = mode && mode !== "new" ? limits.find((l: any) => l.id === mode) : null;
  const isSaving = fetcher.state !== "idle";

  // Navigate back after successful save (not delete)
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && (fetcher.data as any).success) {
      const isDeleteAction = (fetcher.formData?.get("intent") as string) === "DELETE";
      if (!isDeleteAction) {
        const next = new URLSearchParams(searchParams);
        next.delete("mode");
        setSearchParams(next);
      }
    }
  }, [fetcher.state, fetcher.data, searchParams, setSearchParams]);

  const handleSave = (data: any) => {
    const fd = new FormData();
    if (editingRule) fd.append("id", editingRule.id);
    fd.append("intent", editingRule ? "UPDATE" : "CREATE");
    Object.entries(data).forEach(([k, v]) => fd.append(k, v as string));
    fetcher.submit(fd, { method: "post" });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this rule?")) return;
    const fd = new FormData();
    fd.append("id", id);
    fd.append("intent", "DELETE");
    fetcher.submit(fd, { method: "post" });
  };

  const handleDiscard = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("mode");
    setSearchParams(next);
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Order Management", url: "/app/order-management" }, { label: "Order Limit" }]} />
      <s-page heading="Order Limit" back-action-url={mode ? "/app/order-management/order-limit" : "/app/order-management"}>
        {mode ? (
          <OrderLimitEditor
            rule={editingRule}
            onSave={handleSave}
            onDiscard={handleDiscard}
            isSaving={isSaving}
            availableTags={uniqueTags}
          />
        ) : (
          <div style={{ maxWidth: "900px", margin: "0 auto", padding: "10px 20px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "20px" }}>
              <button style={btnDarkStyle} onClick={() => { const next = new URLSearchParams(searchParams); next.set("mode", "new"); setSearchParams(next); }}>
                + Create Order Limit Rule
              </button>
            </div>
            {limits.length === 0 ? (
              <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e1e1e1", padding: "50px", textAlign: "center" }}>
                <p style={{ color: "#6d7175", marginBottom: "20px" }}>No Order Limit rules yet. Create one to restrict minimum or maximum quantities.</p>
                <button style={btnDarkStyle} onClick={() => { const next = new URLSearchParams(searchParams); next.set("mode", "new"); setSearchParams(next); }}>
                  + Create Order Limit Rule
                </button>
              </div>
            ) : (
              <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e1e1e1", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f4f6f8", borderBottom: "1px solid #e1e1e1" }}>
                      <th style={thStyleTable}>Label</th>
                      <th style={thStyleTable}>Status</th>
                      <th style={thStyleTable}>Customer Type</th>
                      <th style={thStyleTable}>Conditions</th>
                      <th style={{ ...thStyleTable, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {limits.map((limit: any) => (
                      <tr key={limit.id} style={{ borderBottom: "1px solid #e1e1e1" }}>
                        <td style={tdStyle}><strong>{limit.label}</strong></td>
                        <td style={tdStyle}>
                          <span style={{ background: limit.status === "enabled" ? "#d3f5d3" : "#f4f6f8", color: limit.status === "enabled" ? "#1a6b1a" : "#6d7175", padding: "3px 10px", borderRadius: "20px", fontSize: "0.85em" }}>
                            {limit.status === "enabled" ? "Enabled" : "Disabled"}
                          </span>
                        </td>
                        <td style={tdStyle}>{limit.customerType === "all" ? "All Customers" : limit.customerType === "logged_in" ? "Logged In" : `Tagged: ${limit.customerTag}`}</td>
                        <td style={tdStyle}>{limit.conditions ? JSON.parse(limit.conditions).length : 0} condition(s)</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <button onClick={() => { const next = new URLSearchParams(searchParams); next.set("mode", limit.id); setSearchParams(next); }} style={btnSecStyle}>Edit</button>
                          <button onClick={() => handleDelete(limit.id)} style={{ ...btnSecStyle, marginLeft: "8px", color: "#d32f2f" }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </s-page>
    </>
  );
}

const cardStyle: React.CSSProperties = { background: "white", padding: "24px", borderRadius: "12px", border: "1px solid #e1e1e1", marginBottom: "20px" };
const labelStyle: React.CSSProperties = { display: "block", fontWeight: "600", marginBottom: "8px", color: "#202223" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "0.95em", boxSizing: "border-box", marginTop: "4px" };
const radioLabel: React.CSSProperties = { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "0.95em" };
const thText: React.CSSProperties = { fontWeight: "600", fontSize: "0.85em", color: "#6d7175" };
const thStyleTable: React.CSSProperties = { padding: "12px 16px", fontWeight: "bold", textAlign: "left" };
const tdStyle: React.CSSProperties = { padding: "14px 16px" };
const btnDarkStyle: React.CSSProperties = { background: "#202223", color: "white", border: "none", padding: "10px 20px", borderRadius: "8px", cursor: "pointer", fontWeight: "600" };
const btnSecStyle: React.CSSProperties = { background: "white", border: "1px solid #c9cccf", padding: "7px 14px", borderRadius: "6px", cursor: "pointer" };
