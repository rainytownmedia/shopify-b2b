import type { LoaderFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { Breadcrumbs } from "../components/Breadcrumbs";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function OrderManagementIndex() {
  const navigate = useNavigate();

  return (
    <>
      <Breadcrumbs items={[{ label: "Order Management" }]} />
      <s-page heading="Order Management" back-action-url="/app">
        <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "10px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            {/* Quick Order Form */}
            <div style={cardStyle}>
              <h2 style={titleStyle}>Quick Order Form</h2>
              <p style={descStyle}>
                Quick Order let customers quickly add multiple items to their cart using SKUs.
              </p>
              <button style={btnStyle} onClick={() => navigate("/app/order-management/quick-order-form")}>
                <span>+</span> Create Quick Order Form
              </button>
              <a href="#" style={linkStyle}>View User Guide</a>
            </div>

            {/* Order Limit */}
            <div style={cardStyle}>
              <h2 style={titleStyle}>Order Limit</h2>
              <p style={descStyle}>
                Order Limit allows you to set minimum and maximum purchase limits for products or the entire cart.
              </p>
              <button style={btnStyle} onClick={() => navigate("/app/order-management/order-limit")}>
                <span>+</span> Create Order Limit Rule
              </button>
              <a href="#" style={linkStyle}>View User Guide</a>
            </div>

            {/* Auto Order Tags */}
            <div style={cardStyle}>
              <h2 style={titleStyle}>Auto Order Tags</h2>
              <p style={descStyle}>
                Configure automatic order tagging based on product metafields to streamline your order processing and fulfillment.
              </p>
              <button style={btnStyle} onClick={() => navigate("/app/order-management/auto-order-tags")}>
                <span>+</span> Create Order Tagging Rules
              </button>
              <a href="#" style={linkStyle}>View User Guide</a>
            </div>
          </div>
        </div>
      </s-page>
    </>
  );
}

const cardStyle: React.CSSProperties = {
  background: "white",
  padding: "28px",
  borderRadius: "12px",
  border: "1px solid #e1e3e5",
  boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};
const titleStyle: React.CSSProperties = {
  fontSize: "1.2em",
  fontWeight: "bold",
  color: "#202223",
};
const descStyle: React.CSSProperties = {
  color: "#6d7175",
  fontSize: "0.95em",
  lineHeight: "1.6",
  flex: 1,
};
const btnStyle: React.CSSProperties = {
  background: "#202223",
  color: "white",
  border: "none",
  padding: "11px 20px",
  borderRadius: "8px",
  fontWeight: "600",
  cursor: "pointer",
  textAlign: "center",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  fontSize: "0.95em",
};
const linkStyle: React.CSSProperties = {
  color: "#005bd3",
  fontSize: "0.9em",
  textDecoration: "none",
};
