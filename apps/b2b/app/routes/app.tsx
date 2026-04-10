import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { Outlet, useLoaderData, useRouteError, useNavigation, useFetchers, Link, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useAppBridge, NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import "@shopify/polaris/build/esm/styles.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

if (typeof document !== 'undefined') {
    const styleId = 'global-app-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .loader-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(255, 255, 255, 0.7);
                backdrop-filter: blur(4px);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
            }
            .spinner-container { display: flex; flexDirection: column; align-items: center; }
            .spinner {
                width: 40px;
                height: 40px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #005bd3;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
        `;
        document.head.appendChild(style);
    }
}

function CustomNavLink({ to, children }: { to: string, children: React.ReactNode }) {
  const location = useLocation();
  const basePath = to.split('?')[0];
  
  // Custom isActive check for our own internal use if needed
  const isHome = basePath === '/app';
  const isActive = isHome
    ? (location.pathname === '/app' || location.pathname === '/app/')
    : (location.pathname === basePath || location.pathname.startsWith(basePath + '/'));

  const hasQueryParams = location.search.length > 0 && !location.search.includes('reset=1');
  
  // We only add reset=1 if we are ALREADY on the exact page and click again
  // but we keep the main 'to' clean for child routes to allow prefix matching in NavMenu
  const isExactButHasQuery = location.pathname === basePath && hasQueryParams;
  const targetTo = isExactButHasQuery ? `${basePath}${basePath.includes('?') ? '&' : '?'}reset=1` : to;

  return <Link to={targetTo} rel={isHome ? "home" : undefined}>{children}</Link>;
}

function AppInner() {
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const shopify = useAppBridge();
  const location = useLocation();
  const navigate = useNavigate();

  // Detect success=true and show global toast
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (shopify && searchParams.get("success") === "true") {
      shopify.toast.show("Plan updated successfully!", { duration: 5000 });
      
      // Clean up the URL
      searchParams.delete("success");
      const newSearch = searchParams.toString();
      navigate(location.pathname + (newSearch ? `?${newSearch}` : ""), { replace: true });
    }
  }, [location.search, location.pathname, shopify, navigate]);

  // Clean up ?reset=1 immediately after navigation
  useEffect(() => {
    if (location.search.includes("reset=1")) {
      const newParams = new URLSearchParams(location.search);
      newParams.delete("reset");
      const newSearch = newParams.toString();
      navigate(location.pathname + (newSearch ? `?${newSearch}` : ""), { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  const isNavigating = 
    navigation.state !== "idle" || 
    fetchers.some(f => f.state !== "idle");

  // Sync with App Bridge native loading bar
  useEffect(() => {
    if (shopify && isNavigating) {
        shopify.loading(true);
    } else if (shopify && !isNavigating) {
        shopify.loading(false);
    }
  }, [isNavigating, shopify]);

  return (
    <>
      <NavMenu>
        <CustomNavLink to="/app">Home</CustomNavLink>
        <CustomNavLink to="/app/tier-pricing">Tier Pricing</CustomNavLink>
        <CustomNavLink to="/app/wholesale-offers">Wholesale Offers</CustomNavLink>
        <CustomNavLink to="/app/cart-discount">Cart Discount</CustomNavLink>
        <CustomNavLink to="/app/checkout-rules">Checkout Rules</CustomNavLink>
        <CustomNavLink to="/app/order-management">Order Management</CustomNavLink>
        <CustomNavLink to="/app/customer-management">B2B Customers</CustomNavLink>
        <CustomNavLink to="/app/import-export">Import / Export</CustomNavLink>
        <CustomNavLink to="/app/pricing">Plans & Pricing</CustomNavLink>
      </NavMenu>
      
      <div style={{ position: "relative", minHeight: "100vh" }}>
        {/* Force custom loader if App Bridge is still handshaking or if navigating */}
        {isNavigating && (
            <div className="loader-overlay" style={{ background: "rgba(255, 255, 255, 0.4)", backdropFilter: "blur(2px)", pointerEvents: "all" }}>
                <div className="spinner-container">
                    <div className="spinner"></div>
                    <div style={{ marginTop: "12px", color: "#005bd3", fontWeight: "600", fontSize: "0.95em" }}>Processing...</div>
                </div>
            </div>
        )}
        <Outlet />
      </div>
    </>
  );
}

import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={enTranslations}>
      <AppProvider embedded apiKey={apiKey}>
        <AppInner />
      </AppProvider>
    </PolarisAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
