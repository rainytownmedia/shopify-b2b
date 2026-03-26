import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { shop: "Store" };
};

export default function Dashboard() {
  const { shop } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Rainytownmedia Wholesale Dashboard">
      {/* Welcome Banner */}
      <div style={{
        background: "linear-gradient(135deg, #005bd3 0%, #002e6b 100%)",
        padding: "40px",
        borderRadius: "16px",
        color: "white",
        marginBottom: "30px",
        boxShadow: "0 10px 20px rgba(0,91,211,0.15)",
        position: "relative",
        overflow: "hidden"
      }}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h1 style={{ fontSize: "2em", fontWeight: "bold", marginBottom: "10px" }}>Welcome to Rainytownmedia Wholesale</h1>
          <p style={{ fontSize: "1.1em", opacity: 0.9, maxWidth: "600px" }}>
            Ready to boost your sales? Set up tier pricing, create exclusive wholesale offers, and incentivize larger orders with cart discounts.
          </p>
        </div>
        <div style={{ position: "absolute", right: "-20px", top: "-20px", width: "200px", height: "200px", background: "rgba(255,255,255,0.05)", borderRadius: "50%", zIndex: 0 }}></div>
      </div>

      {/* Main Feature Pillars - 2x2 Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px", marginBottom: "30px" }}>
        {/* Tier Pricing Card */}
        <div style={featureCardStyle} onClick={() => navigate("/app/tier-pricing")}>
          <div style={{ ...iconCircleStyle, background: "#f1f8e9", color: "#33691e" }}>💹</div>
          <h3 style={featureTitleStyle}>Tier Pricing</h3>
          <p style={featureDescStyle}>Quantity-based discounts for individual products and variants.</p>
          <div style={arrowStyle}>→</div>
        </div>

        {/* Wholesale Offers Card */}
        <div style={featureCardStyle} onClick={() => navigate("/app/wholesale-offers")}>
          <div style={{ ...iconCircleStyle, background: "#fff9db", color: "#856404" }}>🛍️</div>
          <h3 style={featureTitleStyle}>Wholesale Offers</h3>
          <p style={featureDescStyle}>Bulk rules across multiple products or entire collections.</p>
          <div style={arrowStyle}>→</div>
        </div>

        {/* Cart Discounts Card */}
        <div style={featureCardStyle} onClick={() => navigate("/app/cart-discount")}>
          <div style={{ ...iconCircleStyle, background: "#e1f5fe", color: "#01579b" }}>🛒</div>
          <h3 style={featureTitleStyle}>Cart Discounts</h3>
          <p style={featureDescStyle}>Incentivize larger orders with total subtotal-based discounts.</p>
          <div style={arrowStyle}>→</div>
        </div>

        {/* Checkout Rules Card */}
        <div style={featureCardStyle} onClick={() => navigate("/app/checkout-rules")}>
          <div style={{ ...iconCircleStyle, background: "#f3e5f5", color: "#7b1fa2" }}>🛡️</div>
          <h3 style={featureTitleStyle}>Checkout Rules</h3>
          <p style={featureDescStyle}>Hide shipping or payment methods based on customer groups or order value.</p>
          <div style={arrowStyle}>→</div>
        </div>
      </div>

      {/* Getting Started / Footer Section */}
      <div style={{ background: "white", padding: "30px", borderRadius: "16px", border: "1px solid #e1e1e1", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: "1.2em", fontWeight: "bold", marginBottom: "8px" }}>New to Rainy Wholesale?</h2>
          <p style={{ color: "#6d7175" }}>Check out our 5-minute setup guide to learn how to integrate these rules into your theme.</p>
        </div>
        <s-button variant="secondary" onClick={() => window.open("#", "_blank")}>Read Documentation</s-button>
      </div>
    </s-page>
  );
}

// Styles
const featureCardStyle: React.CSSProperties = {
  background: "white",
  padding: "30px",
  borderRadius: "20px",
  border: "1px solid #e1e1e1",
  boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
  transition: "transform 0.2s, box-shadow 0.2s, border-color 0.2s",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  position: "relative"
};

const iconCircleStyle: React.CSSProperties = {
  width: "50px",
  height: "50px",
  borderRadius: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "1.5em",
  marginBottom: "20px"
};

const featureTitleStyle: React.CSSProperties = {
  fontSize: "1.25em",
  fontWeight: "bold",
  marginBottom: "10px",
  color: "#202223"
};

const featureDescStyle: React.CSSProperties = {
  color: "#6d7175",
  fontSize: "0.95em",
  lineHeight: "1.5",
  flex: 1
};

const arrowStyle: React.CSSProperties = {
  marginTop: "20px",
  fontSize: "1.2em",
  color: "#005bd3",
  fontWeight: "bold"
};
