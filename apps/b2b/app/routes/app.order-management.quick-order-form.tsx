import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Breadcrumbs } from "../components/Breadcrumbs";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const forms = await db.quickOrderForm.findMany({
    where: { shopId: session.shop },
    orderBy: { createdAt: "desc" },
  });
  const shopDomain = session.shop;
  return { forms, shopDomain };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "DELETE") {
    const id = formData.get("id") as string;
    await db.quickOrderForm.delete({ where: { id, shopId: session.shop } });
    return Response.json({ success: true });
  }

  const id = formData.get("id") as string | null;
  const title = formData.get("title") as string;
  const status = formData.get("status") as string;
  const settings = formData.get("settings") as string;

  if (id) {
    await db.quickOrderForm.update({
      where: { id, shopId: session.shop },
      data: { title, status, settings },
    });
  } else {
    await db.quickOrderForm.create({
      data: { shopId: session.shop, title, status, settings },
    });
  }
  return Response.json({ success: true });
};

const DEFAULT_SETTINGS = {
  bgHeader: "#3a3a3a", bgRow: "#ffffff", headerColor: "#000000",
  rowTextColor: "#333333", borderColor: "#000000", bgButton: "#3a3a3a",
  buttonColor: "#ffffff", buttonHoverColor: "#3a3a3a", buttonTextHoverColor: "#ffffff",
  borderSize: "1", borderStyle: "solid",
};

function ColorBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "44px", height: "34px", border: "1px solid #c9cccf", borderRadius: "4px", cursor: "pointer", padding: "2px" }} />
      <span style={{ fontSize: "0.95em", color: "#202223" }}>{label}</span>
    </div>
  );
}

function QuickOrderFormEditor({ form, shopDomain, onSave, onDiscard, isSaving }: any) {
  const [title, setTitle] = useState(form?.title || "Quick Order Form");
  const [status, setStatus] = useState(form?.status || "active");
  const existing = form?.settings ? JSON.parse(form.settings) : {};
  const [colors, setColors] = useState({ ...DEFAULT_SETTINGS, ...existing });
  const displayUrl = `https://${shopDomain}/apps/rainytownmedia-b2b/quick-order`;
  const setColor = (key: string, val: string) => setColors((c: any) => ({ ...c, [key]: val }));

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "24px" }}>
        <button onClick={onDiscard} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1em", color: "#005bd3" }}>← Quick Order Form</button>
        <span style={{ background: "#d3f5d3", color: "#1a6b1a", padding: "3px 10px", borderRadius: "20px", fontSize: "0.85em", fontWeight: "600" }}>
          {status === "active" ? "Active" : "Inactive"}
        </span>
      </div>

      <div style={cardStyle}>
        <label style={labelStyle}>Title</label>
        <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="Quick Order Form" />
        <label style={{ ...labelStyle, marginTop: "18px" }}>Display On Page</label>
        <div style={{ ...inputStyle, background: "#f4f6f8", color: "#6d7175", cursor: "default" }}>{displayUrl}</div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontWeight: "bold", fontSize: "1.1em", marginBottom: "20px", color: "#202223" }}>Settings</h3>
        <h4 style={{ fontWeight: "600", marginBottom: "14px", color: "#202223" }}>Colors</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
          <ColorBox label="Background table header" value={colors.bgHeader} onChange={v => setColor("bgHeader", v)} />
          <ColorBox label="Background table row" value={colors.bgRow} onChange={v => setColor("bgRow", v)} />
          <ColorBox label="Header Color" value={colors.headerColor} onChange={v => setColor("headerColor", v)} />
          <ColorBox label="Row text color" value={colors.rowTextColor} onChange={v => setColor("rowTextColor", v)} />
          <ColorBox label="Border Color" value={colors.borderColor} onChange={v => setColor("borderColor", v)} />
          <ColorBox label="Background Button" value={colors.bgButton} onChange={v => setColor("bgButton", v)} />
          <ColorBox label="Button Color" value={colors.buttonColor} onChange={v => setColor("buttonColor", v)} />
          <ColorBox label="Button hover Color" value={colors.buttonHoverColor} onChange={v => setColor("buttonHoverColor", v)} />
          <ColorBox label="Button text hover Color" value={colors.buttonTextHoverColor} onChange={v => setColor("buttonTextHoverColor", v)} />
        </div>
        <div style={{ borderTop: "1px solid #e1e1e1", marginTop: "20px", paddingTop: "20px" }}>
          <h4 style={{ fontWeight: "600", marginBottom: "14px", color: "#202223" }}>Border</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={{ fontSize: "0.9em", color: "#6d7175", display: "block", marginBottom: "6px" }}>Border size</label>
              <input type="number" min="0" max="10" style={inputStyle} value={colors.borderSize} onChange={e => setColor("borderSize", e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: "0.9em", color: "#6d7175", display: "block", marginBottom: "6px" }}>Border style</label>
              <select style={inputStyle} value={colors.borderStyle} onChange={e => setColor("borderStyle", e.target.value)}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid #e1e1e1", marginTop: "20px", paddingTop: "20px" }}>
          <h4 style={{ fontWeight: "600", marginBottom: "14px", color: "#202223" }}>Status</h4>
          <div style={{ display: "flex", gap: "20px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input type="radio" name="status" value="active" checked={status === "active"} onChange={() => setStatus("active")} />
              <span>Active</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input type="radio" name="status" value="inactive" checked={status === "inactive"} onChange={() => setStatus("inactive")} />
              <span>Inactive</span>
            </label>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "20px" }}>
        <button onClick={onDiscard} style={{ padding: "10px 20px", background: "white", border: "1px solid #c9cccf", borderRadius: "8px", cursor: "pointer" }}>Discard</button>
        <button onClick={() => onSave({ title, status, settings: JSON.stringify(colors) })} disabled={isSaving}
          style={{ padding: "10px 24px", background: "#202223", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}>
          {isSaving ? "Saving..." : form ? "Save Changes" : "Create Form"}
        </button>
      </div>
    </div>
  );
}

export default function QuickOrderFormPage() {
  const { forms, shopDomain } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();

  const mode = searchParams.get("mode");
  const editingForm = mode && mode !== "new" ? forms.find((f: any) => f.id === mode) : null;
  const isSaving = fetcher.state !== "idle";
  const [wasSubmitting, setWasSubmitting] = useState(false);

  // Mark when starting a save/delete action
  useEffect(() => {
    if (fetcher.state === "submitting" || fetcher.state === "loading") {
      setWasSubmitting(true);
    }
  }, [fetcher.state]);

  // Navigate back to list after successful save
  useEffect(() => {
    if (fetcher.state === "idle" && wasSubmitting && (fetcher.data as any)?.success) {
      setWasSubmitting(false);
      const isDeleteAction = (fetcher.formData?.get("intent") as string) === "DELETE";
      if (!isDeleteAction && mode) {
        const next = new URLSearchParams(searchParams);
        next.delete("mode");
        setSearchParams(next);
      }
    }
  }, [fetcher.state, fetcher.data, wasSubmitting, searchParams, setSearchParams, mode]);

  const handleSave = (data: any) => {
    const fd = new FormData();
    if (editingForm) fd.append("id", editingForm.id);
    fd.append("intent", editingForm ? "UPDATE" : "CREATE");
    fd.append("title", data.title);
    fd.append("status", data.status);
    fd.append("settings", data.settings);
    fetcher.submit(fd, { method: "post" });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this form?")) return;
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

  const breadcrumbs = [
    { label: "Order Management", url: "/app/order-management" },
    { label: "Quick Order Form" }
  ];

  return (
    <>
      <Breadcrumbs items={breadcrumbs} />
      <s-page heading="Quick Order Form" back-action-url={mode ? "/app/order-management/quick-order-form" : "/app/order-management"}>
        {mode ? (
           <QuickOrderFormEditor form={editingForm} shopDomain={shopDomain} onSave={handleSave} onDiscard={handleDiscard} isSaving={isSaving} />
        ) : (
          <div style={{ maxWidth: "900px", margin: "0 auto", padding: "10px 20px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "20px" }}>
              <button style={btnDarkStyle} onClick={() => { const next = new URLSearchParams(searchParams); next.set("mode", "new"); setSearchParams(next); }}>
                + Create Quick Order Form
              </button>
            </div>
            {forms.length === 0 ? (
              <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e1e1e1", padding: "50px", textAlign: "center" }}>
                <p style={{ color: "#6d7175", marginBottom: "20px" }}>No Quick Order Forms yet. Create your first one!</p>
                <button style={btnDarkStyle} onClick={() => { const next = new URLSearchParams(searchParams); next.set("mode", "new"); setSearchParams(next); }}>
                  + Create Quick Order Form
                </button>
              </div>
            ) : (
              <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e1e1e1", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f4f6f8", borderBottom: "1px solid #e1e1e1" }}>
                      <th style={thStyle}>Title</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Created</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forms.map((form: any) => (
                      <tr key={form.id} style={{ borderBottom: "1px solid #e1e1e1" }}>
                        <td style={tdStyle}><strong>{form.title}</strong></td>
                        <td style={tdStyle}>
                          <span style={{ background: form.status === "active" ? "#d3f5d3" : "#f4f6f8", color: form.status === "active" ? "#1a6b1a" : "#6d7175", padding: "3px 10px", borderRadius: "20px", fontSize: "0.85em" }}>
                            {form.status === "active" ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td style={tdStyle}>{new Date(form.createdAt).toLocaleDateString()}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <button onClick={() => { const next = new URLSearchParams(searchParams); next.set("mode", form.id); setSearchParams(next); }} style={btnSecStyle}>Edit</button>
                          <button onClick={() => handleDelete(form.id)} style={{ ...btnSecStyle, marginLeft: "8px", color: "#d32f2f" }}>Delete</button>
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
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "0.95em", boxSizing: "border-box" };
const thStyle: React.CSSProperties = { padding: "12px 16px", fontWeight: "bold", textAlign: "left" };
const tdStyle: React.CSSProperties = { padding: "14px 16px" };
const btnDarkStyle: React.CSSProperties = { background: "#202223", color: "white", border: "none", padding: "10px 20px", borderRadius: "8px", cursor: "pointer", fontWeight: "600" };
const btnSecStyle: React.CSSProperties = { background: "white", border: "1px solid #c9cccf", padding: "7px 14px", borderRadius: "6px", cursor: "pointer" };
