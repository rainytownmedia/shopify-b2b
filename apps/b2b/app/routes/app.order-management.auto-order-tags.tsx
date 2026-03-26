import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Breadcrumbs } from "../components/Breadcrumbs";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await db.autoOrderTag.findUnique({ where: { shopId: session.shop } });
  return { config };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const enableAutoTag = formData.get("enableAutoTag") === "true";
  const enableWarehouse = formData.get("enableWarehouse") === "true";
  const enableBrand = formData.get("enableBrand") === "true";
  const customRules = formData.get("customRules") as string | null;

  await db.autoOrderTag.upsert({
    where: { shopId: session.shop },
    update: { enableAutoTag, enableWarehouse, enableBrand, customRules },
    create: { shopId: session.shop, enableAutoTag, enableWarehouse, enableBrand, customRules },
  });
  return Response.json({ success: true });
};

export default function AutoOrderTagsPage() {
  const { config } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";

  const [enableAutoTag, setEnableAutoTag] = useState(config?.enableAutoTag ?? false);
  const [enableWarehouse, setEnableWarehouse] = useState(config?.enableWarehouse ?? false);
  const [enableBrand, setEnableBrand] = useState(config?.enableBrand ?? false);

  const handleSave = () => {
    const fd = new FormData();
    fd.append("enableAutoTag", String(enableAutoTag));
    fd.append("enableWarehouse", String(enableWarehouse));
    fd.append("enableBrand", String(enableBrand));
    submit(fd, { method: "post" });
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Order Management", url: "/app/order-management" }, { label: "Auto Order Tags" }]} />
      <s-page heading="Auto Order Tags" back-action-url="/app/order-management">
        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "10px 20px" }}>
          {/* Info banners */}
          <div style={{ background: "#fff8e1", border: "1px solid #ffe082", borderRadius: "10px", padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "16px" }}>
            <span style={{ fontSize: "1.2em", marginTop: "2px" }}>⚠️</span>
            <div style={{ flex: 1, fontSize: "0.9em", color: "#795548" }}>
              The Auto Order Tag feature is available for Essential Plan subscribers.{" "}
              <a href="#" style={{ color: "#005bd3", fontWeight: "600" }}>Upgrade to Essential Plan</a>
            </div>
            <span style={{ cursor: "pointer", color: "#6d7175" }}>×</span>
          </div>

          <div style={{ background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: "10px", padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "24px" }}>
            <span style={{ fontSize: "1.2em", marginTop: "2px" }}>ℹ️</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "0.9em", color: "#1565c0", margin: "0 0 10px 0" }}>
                You need to enable the Widget in your Theme Editor for the Auto Order Tag to be displayed on the product page.<br />
                Note: If it's already enabled, you can ignore this message.
              </p>
              <button style={{ background: "#202223", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontWeight: "600", fontSize: "0.85em" }}>
                Go to Additional Settings
              </button>
            </div>
            <span style={{ cursor: "pointer", color: "#6d7175" }}>×</span>
          </div>

          {/* Create Order Tagging Rules section */}
          <div style={cardStyle}>
            <h2 style={{ fontWeight: "bold", fontSize: "1.1em", marginBottom: "8px", color: "#202223" }}>Create Order Tagging Rules</h2>
            <p style={{ color: "#6d7175", fontSize: "0.9em", lineHeight: "1.5" }}>
              Automatically tag orders using product metafields like brand, warehouse, or other details to keep your orders organized and easier to manage.
            </p>
          </div>

          {/* Enable Auto Tag */}
          <div style={toggleCardStyle}>
            <label style={toggleRowStyle}>
              <input
                type="checkbox"
                checked={enableAutoTag}
                onChange={e => setEnableAutoTag(e.target.checked)}
                style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#202223" }}
              />
              <div>
                <div style={{ fontWeight: "600", color: "#202223" }}>Enable Auto Tag</div>
                <div style={{ fontSize: "0.85em", color: "#6d7175", marginTop: "3px" }}>Automatically apply order tags based on product metafields when an order is placed.</div>
              </div>
            </label>
          </div>

          {/* Warehouse Tag */}
          <div style={toggleCardStyle}>
            <label style={toggleRowStyle}>
              <input
                type="checkbox"
                checked={enableWarehouse}
                onChange={e => setEnableWarehouse(e.target.checked)}
                style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#202223" }}
              />
              <div>
                <div style={{ fontWeight: "600", color: "#202223" }}>Warehouse Tag</div>
                <div style={{ fontSize: "0.85em", color: "#6d7175", marginTop: "3px" }}>
                  When a product has a <code style={{ background: "#f4f6f8", padding: "1px 5px", borderRadius: "3px" }}>warehouse</code> metafield, automatically tag the order with that warehouse value (e.g., WH-East, WH-West) for easier fulfillment routing.
                </div>
              </div>
            </label>
          </div>

          {/* Brand Tag */}
          <div style={toggleCardStyle}>
            <label style={toggleRowStyle}>
              <input
                type="checkbox"
                checked={enableBrand}
                onChange={e => setEnableBrand(e.target.checked)}
                style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#202223" }}
              />
              <div>
                <div style={{ fontWeight: "600", color: "#202223" }}>Brand Tag</div>
                <div style={{ fontSize: "0.85em", color: "#6d7175", marginTop: "3px" }}>
                  When a product has a <code style={{ background: "#f4f6f8", padding: "1px 5px", borderRadius: "3px" }}>brand</code> metafield, automatically tag the order with that brand name (e.g., Nike, Adidas) for brand-based order filtering.
                </div>
              </div>
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "24px" }}>
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{ background: "#202223", color: "white", border: "none", padding: "10px 28px", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "0.95em" }}
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </div>
      </s-page>
    </>
  );
}

const cardStyle: React.CSSProperties = { background: "white", padding: "24px", borderRadius: "12px", border: "1px solid #e1e1e1", marginBottom: "16px" };
const toggleCardStyle: React.CSSProperties = { background: "white", padding: "20px 24px", borderRadius: "12px", border: "1px solid #e1e1e1", marginBottom: "12px" };
const toggleRowStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: "16px", cursor: "pointer" };
