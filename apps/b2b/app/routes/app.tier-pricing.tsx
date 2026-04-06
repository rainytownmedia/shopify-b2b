import { useState, useEffect, useRef, Fragment } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation, useBlocker } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkUsage } from "../utils/quota.server";
import React from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Banner } from "@shopify/polaris";

/**
 * LOADER
 * Specifically filters PriceLists with category: "TIER"
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("query") || "";

  try {
    const mode = url.searchParams.get("mode");
    const selectedProductId = url.searchParams.get("productId");

    let productJson: any = { data: { products: { edges: [] } } };

    if (mode) {
      if (selectedProductId) {
        const pRes = await admin.graphql(
          `#graphql
           query getProduct {
             product(id: "${selectedProductId}") {
               id title handle featuredImage { url }
               variants(first: 50) { edges { node { id title price } } }
             }
           }`
        );
        const json: any = await pRes.json();
        productJson = {
          data: {
            products: {
              edges: json.data?.product ? [{ node: json.data.product }] : []
            }
          }
        };
      } else {
        const pRes = await admin.graphql(
          `#graphql
           query getProducts($query: String) {
             products(first: 250, query: $query) {
               edges { node { id title handle featuredImage { url } } }
             }
           }`,
          { variables: { query: searchTerm } }
        );
        productJson = await pRes.json();
      }
    }

    const [pLists, pItems, allTagsLists] = await Promise.all([
      db.priceList.findMany({ where: { shopId: session.shop, category: "TIER" } }),
      db.priceListItem.findMany({
        where: { priceList: { shopId: session.shop, category: "TIER" } },
        include: { priceList: true }
      }),
      db.priceList.findMany({ where: { shopId: session.shop }, select: { customerTag: true } })
    ]);

    let cJson: any = null;
    try {
      const cRes = await admin.graphql(`
        #graphql
        query getCustomerTags {
          customers(first: 250) { edges { node { tags } } }
        }
      `);
      cJson = await cRes.json();
    } catch (e) {
      console.warn("Could not fetch Shopify customers (might be missing read_customers scope)", e);
    }

    const shopifyTags = new Set<string>();
    if (cJson?.data?.customers?.edges) {
        cJson.data.customers.edges.forEach((e: any) => {
            e.node.tags.forEach((t: string) => shopifyTags.add(t));
        });
    }

    // Combine DB tags and Shopify DB tags
    const dbTags = allTagsLists.map(l => l.customerTag);
    const uniqueTags = Array.from(new Set([...dbTags, ...Array.from(shopifyTags)]));
    if (!uniqueTags.includes("ALL")) uniqueTags.unshift("ALL");

    const usage = await checkUsage(session.shop);

    return {
      products: productJson.data?.products?.edges || [],
      priceLists: pLists,
      priceItems: pItems,
      uniqueTags: uniqueTags,
      searchTerm,
      usage
    };
  } catch (error) {
    console.error("Loader fetch error:", error);
    return { products: [], collections: [], priceLists: [], priceItems: [], uniqueTags: [], searchTerm, error: "Network error" };
  }
};

/**
 * ACTION
 * Saves Tier Pricing rules with category: "TIER"
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  try {
    if (actionType === "saveAllTierRules") {
      const productId = formData.get("productId") as string;
      const mode = formData.get("mode") as string;
      const rulesData = JSON.parse(formData.get("rules") as string);

      const savedRules = [];
      const tagMap = new Map();

      for (const r of rulesData) {
         const tag = r.tag || "ALL";
         let listId = tagMap.get(tag);
         if (!listId) {
             let pl = await db.priceList.findFirst({
                 where: { shopId: session.shop, category: "TIER", customerTag: tag }
             });
             if (!pl) {
                 pl = await db.priceList.create({
                     data: { shopId: session.shop, name: `${tag} Tiers`, customerTag: tag, category: "TIER" }
                 });
             }
             listId = pl.id;
             tagMap.set(tag, listId);
         }
         savedRules.push({
            priceListId: listId,
            productId: productId,
            variantId: r.variantId || null,
            minQuantity: parseInt(r.minQuantity),
            discountType: r.discountType,
            price: parseFloat(r.price)
         });
      }

      // Check Quota before creating/updating
      // We are deleting many and creating many so it's a replace operation.
      // But if the total count INCREASES, we must ensure it doesn't exceed the limit.
      const usage = await checkUsage(session.shop);
      const currentItemCount = await db.priceListItem.count({
          where: { 
            productId: productId,
            priceList: { category: "TIER" },
            variantId: mode === "individual" ? { not: null } : null
          }
      });
      // netIncrease = new items - old items
      const netIncrease = savedRules.length - currentItemCount;
      if (netIncrease > 0 && usage.totalRows + netIncrease > usage.maxRowLimit) {
         return { error: `Storage Limit Exceeded! You are trying to add ${netIncrease} new rules, but you only have ${usage.maxRowLimit - usage.totalRows} slots left. Please upgrade your plan.` };
      }

      await db.$transaction([
        db.priceListItem.deleteMany({ 
          where: { 
            productId: productId,
            priceList: { category: "TIER" },
            variantId: mode === "individual" ? { not: null } : null
          } 
        }),
        db.priceListItem.createMany({
          data: savedRules
        })
      ]);

      // --- SYNC TO SHOPIFY METAFIELDS ---
      // Fetch all rules for this product to keep the Metafield complete
      const allProductRules = await db.priceListItem.findMany({
          where: { productId },
          include: { priceList: true }
      });
      
      const metafieldData = allProductRules.map(r => ({
          tag: r.priceList.customerTag,
          category: r.priceList.category,
          variantId: r.variantId,
          minQuantity: r.minQuantity,
          discountType: r.discountType,
          price: parseFloat(r.price.toString()),
      }));

      const { admin } = await authenticate.admin(request);
      
      const mfResponse = await admin.graphql(
        `#graphql
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            "metafields": [
              {
                "ownerId": productId,
                "namespace": "b2b_app",
                "key": "tier_rules",
                "type": "json",
                "value": JSON.stringify(metafieldData)
              }
            ]
          }
        }
      );
      
      const mfData = await mfResponse.json();
      if (mfData.data?.metafieldsSet?.userErrors?.length > 0) {
          console.error("Metafield Sync Error:", mfData.data.metafieldsSet.userErrors);
          return { error: "Rules saved but failed to sync to Shopify Functions." };
      }
      // ----------------------------------
    } else if (actionType === "createGroup") {
      await db.priceList.create({
        data: { shopId: session.shop, name: formData.get("name") as string, customerTag: formData.get("tag") as string, category: "TIER" }
      });
    }
  } catch (error: any) {
    return { error: error.message };
  }
  return { success: true };
};

export default function TierPricingPage() {
  const { products, priceItems, uniqueTags, searchTerm, usage } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const navigation = useNavigation();

  const mode = searchParams.get("mode"); // 'individual', 'product'
  const selectedProductId = searchParams.get("productId");
  const [search, setSearch] = useState(searchTerm);
  const [localRules, setLocalRules] = useState<any[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Stop loading indicator when products or mode changes (navigation finished)
  useEffect(() => {
    setIsNavigating(false);
  }, [mode, selectedProductId, products, uniqueTags]);

  const selectedProduct = products.find((p: any) => p.node.id === selectedProductId)?.node;
  const isDashboard = !mode && !selectedProductId;
  
  const isActionLoading = isNavigating || navigation.state !== "idle" || fetcher.state !== "idle";

  const handleNavigate = (newParams: URLSearchParams) => {
    setIsNavigating(true);
    setSearchParams(newParams);
  };

  const AutocompleteSelect = ({ value, onChange, availableTags }: { value: string, onChange: (val: string) => void, availableTags: string[] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState(value || "");
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => setSearch(value || ""), [value]);

    useEffect(() => {
        function handleClickOutside(event: any) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
                if (search !== value && search.trim() !== "") onChange(search.trim());
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [search, value, onChange]);

    const filtered = availableTags.filter(t => t.toLowerCase().includes(search.toLowerCase()));

    return (
        <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
            <input 
                type="text" 
                style={inputStyle}
                placeholder="e.g. ALL, wholesale..."
                value={search}
                onChange={e => { setSearch(e.target.value); setIsOpen(true); }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={e => {
                   if (e.key === "Enter") {
                       e.preventDefault();
                       if (search.trim() !== "") onChange(search.trim());
                       setIsOpen(false);
                   }
                }}
            />
            {isOpen && (
                <div style={{ position: "absolute", zIndex: 10, width: "100%", background: "white", border: "1px solid #ccc", borderRadius: "6px", maxHeight: "150px", overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", marginTop: "4px" }}>
                    {filtered.map(tag => (
                        <div 
                            key={tag} 
                            style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #eee", background: value === tag ? "#f4f6f8" : "white" }}
                            onMouseDown={(e) => { e.preventDefault(); onChange(tag); setIsOpen(false); }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f4f6f8"}
                            onMouseLeave={e => e.currentTarget.style.background = value === tag ? "#f4f6f8" : "white"}
                        >
                            {tag}
                        </div>
                    ))}
                    {search.trim() !== "" && !availableTags.map(t=>t.toLowerCase()).includes(search.trim().toLowerCase()) && (
                         <div 
                            style={{ padding: "8px 12px", cursor: "pointer", color: "#008060", fontStyle: "italic", borderBottom: "1px solid #eee" }}
                            onMouseDown={(e) => { e.preventDefault(); onChange(search.trim()); setIsOpen(false); }}
                        >
                            + Create tag "{search.trim()}"
                        </div>
                    )}
                </div>
            )}
        </div>
    );
  }

  // Global Navigation Blocker
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasChanges && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search
  );

  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("You have unsaved changes. Are you sure you want to leave?")) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker]);

  // Sync initial rules when selecting a product
  useEffect(() => {
    if (selectedProductId) {
      const dbItems = priceItems.filter((i: any) => 
        i.productId === selectedProductId && 
        (mode === "individual" ? i.variantId !== null : i.variantId === null)
      );
      setLocalRules(dbItems.map((i: any, index: number) => ({ 
          ...i, 
          tag: i.priceList ? i.priceList.customerTag : "ALL",
          tempId: `rule-${index}` 
        })));
      setHasChanges(false);
    }
  }, [selectedProductId, priceItems, mode]);

  const handleSave = () => {
    fetcher.submit({
      actionType: "saveAllTierRules",
      productId: selectedProductId!,
      mode: mode!,
      rules: JSON.stringify(localRules)
    }, { method: "POST" });
    setHasChanges(false);
    shopify.toast.show("Tier pricing saved");
  };

  const addRule = (variantId: string | null) => {
    setLocalRules([...localRules, {
        tempId: `rule-${Date.now()}`,
        variantId: variantId,
        tag: "ALL",
        minQuantity: 2,
        discountType: "PERCENTAGE",
        price: 0
    }]);
    setHasChanges(true);
  };

  const renderUsageBanner = () => {
    if (!usage) return null;
    if (usage.isLimitReached) {
       return (
         <div style={{ marginBottom: "20px" }}>
           <Banner tone="critical" title="Storage Limit Reached">
             You have used all {usage.maxRowLimit} allowed rules ({usage.currentGb} GB). You cannot add new tier pricing rules until you <strong><a href="/app/pricing">upgrade your plan</a></strong>.
           </Banner>
         </div>
       );
    }
    if (usage.isWarning) {
       return (
         <div style={{ marginBottom: "20px" }}>
           <Banner tone="warning" title="Storage Limit Approaching">
             You have used {usage.totalRows} out of {usage.maxRowLimit} allowed rules ({usage.currentGb} GB). <strong><a href="/app/pricing">Upgrade your plan</a></strong> soon to continue growing your B2B offerings without interruption.
           </Banner>
         </div>
       );
    }
    return null;
  };

  // --- RENDERING ---

  // Common Loading Overlay
  const renderLoadingOverlay = () => {
      if (!isActionLoading) return null;
      return (
          <div className="loader-overlay" style={{ background: "rgba(255, 255, 255, 0.4)", backdropFilter: "blur(2px)", pointerEvents: "all" }}>
              <div className="spinner-container">
                  <div className="spinner"></div>
                  <div style={{ marginTop: "12px", color: "#005bd3", fontWeight: "600", fontSize: "0.95em" }}>Processing...</div>
              </div>
          </div>
      );
  };

  if (isDashboard) {
    return (
      <>
        <Breadcrumbs items={[{ label: "Tier Pricing" }]} />
        <s-page heading="Tier Pricing Dashboard" back-action-url="/app">
          {renderLoadingOverlay()}
          {renderUsageBanner()}
          {/* Guide Banner */}
          <div style={{ background: "#f1f8e9", padding: "16px", borderRadius: "12px", border: "1px solid #dcedc8", marginBottom: "30px", display: "flex", alignItems: "center", gap: "15px" }}>
             <span style={{ fontSize: "1.5em" }}>💡</span>
             <div style={{ fontSize: "0.95em", color: "#33691e", lineHeight: "1.5" }}>
                <strong>Tier Pricing Guide:</strong> Encourage customers to buy more of the <strong>same product</strong> by offering discounts based on quantity tiers for individual variants or entire products.
             </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
              <div style={cardStyle}>
                  <div style={cardIconStyle}>🛍️</div>
                  <h2 style={cardTitleStyle}>Tier Price (Individual Variant)</h2>
                  <p style={cardDescStyle}>Rules apply to EACH variant's quantity separately. Best for products where variants have different costs.</p>
                  <s-button variant="primary" onClick={() => {
                     const next = new URLSearchParams(searchParams);
                     next.set("mode", "individual");
                     handleNavigate(next);
                  }}>Manage Variant Tiers</s-button>
              </div>
              <div style={cardStyle}>
                  <div style={cardIconStyle}>📦</div>
                  <h2 style={cardTitleStyle}>Tier Price (Product Level)</h2>
                  <p style={cardDescStyle}>Mix & Match: Rules apply to the TOTAL quantity of all variants of a single product combined.</p>
                  <s-button variant="primary" onClick={() => {
                     const next = new URLSearchParams(searchParams);
                     next.set("mode", "product");
                     handleNavigate(next);
                  }}>Manage Product Tiers</s-button>
              </div>
          </div>
        </s-page>
      </>
    );
  }

  if (mode && !selectedProductId) {
    return (
      <>
        <Breadcrumbs items={[{ label: "Tier Pricing", url: "/app/tier-pricing" }, { label: mode === "individual" ? "Variant Tiers" : "Product Tiers" }]} />
        <s-page heading={mode === "individual" ? "Variant Tier Pricing" : "Product Tier Pricing"} back-action-url="/app/tier-pricing">
            {renderLoadingOverlay()}
            {renderUsageBanner()}
            <div style={{ marginBottom: "20px" }}>
                <s-button variant="secondary" onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("mode");
                    handleNavigate(next);
                }}>← Back to Dashboard</s-button>
            </div>
            
            {/* Warning if no tags exist */}
            {uniqueTags.length <= 1 && (
                <div style={{ background: "#fff3cd", color: "#856404", padding: "16px", borderRadius: "8px", border: "1px solid #ffeeba", marginBottom: "20px" }}>
                    <strong>No Tags Found!</strong> You should create a Customer Tag like "VIP" or "Wholesale" first to assign them.
                </div>
            )}

            <div style={{ background: "white", padding: "20px", borderRadius: "12px", border: "1px solid #ddd", marginBottom: "20px" }}>
                <input type="text" placeholder="Search products..." value={search} onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }} style={inputStyle} />
            </div>
            <div style={{ background: "white", borderRadius: "12px", border: "1px solid #ddd", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "15px" }}>
                    <thead>
                        <tr style={{ textAlign: "left", background: "#fcfcfc", borderBottom: "1px solid #eee" }}>
                            <th style={thStyle}>Product</th>
                            <th style={thStyle}>Active Tiers</th>
                            <th style={thStyle}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(() => {
                            const filteredProducts = products.filter((p: any) => p.node.title.toLowerCase().includes(search.toLowerCase()));
                            const paginatedProducts = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
                            
                            if (paginatedProducts.length === 0) {
                                return <tr><td colSpan={3} style={{ ...tdStyle, textAlign: "center", fontStyle: "italic", color: "#888", padding: "30px 0" }}>No products found.</td></tr>;
                            }

                            return paginatedProducts.map(({ node: p }: any) => {
                                const tiersCount = priceItems.filter((i:any) => i.productId === p.id && (mode === 'individual' ? i.variantId !== null : i.variantId === null)).length;
                                return (
                                    <tr key={p.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                                        <td style={tdStyle}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                <img src={p.featuredImage?.url || ""} style={{ width: "32px", height: "32px", borderRadius: "4px", objectFit: "cover" }} alt="" />
                                                <strong>{p.title}</strong>
                                            </div>
                                        </td>
                                        <td style={tdStyle}>{tiersCount} tiers</td>
                                        <td style={tdStyle}>
                                            <s-button variant="secondary" onClick={() => {
                                                const next = new URLSearchParams(searchParams);
                                                next.set("productId", p.id);
                                                handleNavigate(next);
                                            }}>Edit Tiers</s-button>
                                        </td>
                                    </tr>
                                );
                            });
                        })()}
                    </tbody>
                </table>

                {/* Pagination Controls */}
                {(() => {
                    const filteredLength = products.filter((p: any) => p.node.title.toLowerCase().includes(search.toLowerCase())).length;
                    const totalPages = Math.ceil(filteredLength / itemsPerPage);
                    if (totalPages <= 1) return null;
                    return (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 20px", borderTop: "1px solid #eee", background: "#fcfcfc" }}>
                            <span style={{ fontSize: "0.9em", color: "#666" }}>Showing page {currentPage} of {totalPages}</span>
                            <div style={{ display: "flex", gap: "10px" }}>
                                <button 
                                    disabled={currentPage === 1} 
                                    onClick={() => setCurrentPage(c => Math.max(1, c - 1))}
                                    style={{ padding: "6px 12px", border: "1px solid #ccc", background: "white", cursor: currentPage === 1 ? "not-allowed" : "pointer", opacity: currentPage === 1 ? 0.5 : 1, borderRadius: "4px" }}
                                >
                                    Previous
                                </button>
                                <button 
                                    disabled={currentPage === totalPages} 
                                    onClick={() => setCurrentPage(c => Math.min(totalPages, c + 1))}
                                    style={{ padding: "6px 12px", border: "1px solid #ccc", background: "white", cursor: currentPage === totalPages ? "not-allowed" : "pointer", opacity: currentPage === totalPages ? 0.5 : 1, borderRadius: "4px" }}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </div>
        </s-page>
      </>
    );
  }

  if (selectedProductId && selectedProduct) {
    const breadcrumbLabel = mode === "individual" ? "Variant Tiers" : "Product Tiers";
    return (
      <>
        <Breadcrumbs items={[
          { label: "Tier Pricing", url: "/app/tier-pricing" }, 
          { label: breadcrumbLabel, url: `/app/tier-pricing?mode=${mode}` },
          { label: selectedProduct.title }
        ]} />
        <s-page heading={`Manage Tiers: ${selectedProduct.title}`} back-action-url={`/app/tier-pricing?mode=${mode}`}>
            {renderLoadingOverlay()}
            {renderUsageBanner()}
            <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between" }}>
                <s-button variant="secondary" onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("productId");
                    handleNavigate(next);
                }}>← Back</s-button>
                <s-button variant="primary" onClick={handleSave} disabled={usage?.isLimitReached && hasChanges && localRules.length > priceItems.filter((i:any) => i.productId === selectedProductId && (mode === "individual" ? i.variantId !== null : i.variantId === null)).length}>SAVE TIERS</s-button>
            </div>

            <div style={{ background: "white", borderRadius: "12px", border: "1px solid #ddd", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", background: "#f8f8f8" }}>
                            <th style={thStyle}>{mode === "individual" ? "Variant" : "Applicable To"}</th>
                            <th style={thStyle}>Customer Tags</th>
                            <th style={thStyle}>Min Quantity</th>
                            <th style={thStyle}>Discount Type</th>
                            <th style={thStyle}>Value</th>
                            <th style={thStyle}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mode === "individual" ? (
                            selectedProduct.variants.edges.map(({ node: variant }: any) => {
                                const variantRules = localRules.filter(r => r.variantId === variant.id);
                                return (
                                    <Fragment key={variant.id}>
                                        <tr style={{ background: "#fcfcff" }}>
                                            <td colSpan={6} style={{ ...tdStyle, fontWeight: "bold" }}>{variant.title} - ${variant.price}</td>
                                        </tr>
                                        {variantRules.map((rule, idx) => (
                                            <tr key={rule.tempId}>
                                                <td></td>
                                                <td style={tdStyle}>
                                                    <AutocompleteSelect 
                                                        value={rule.tag || ""} 
                                                        availableTags={uniqueTags}
                                                        onChange={(val) => { const nr=[...localRules]; nr.find(r=>r.tempId===rule.tempId).tag=val; setLocalRules(nr); setHasChanges(true); }}
                                                    />
                                                </td>
                                                <td style={tdStyle}><input type="number" style={inputStyle} value={rule.minQuantity} onChange={(e) => { const nr = [...localRules]; nr.find(r=>r.tempId===rule.tempId).minQuantity=e.target.value; setLocalRules(nr); setHasChanges(true); }} /></td>
                                                <td style={tdStyle}>
                                                    <select style={inputStyle} value={rule.discountType} onChange={(e) => { const nr=[...localRules]; nr.find(r=>r.tempId===rule.tempId).discountType=e.target.value; setLocalRules(nr); setHasChanges(true); }}>
                                                        <option value="PERCENTAGE">Percentage OFF</option>
                                                        <option value="FIXED_PRICE">Fixed Price</option>
                                                    </select>
                                                </td>
                                                <td style={tdStyle}><input type="number" style={inputStyle} value={rule.price} onChange={(e) => { const nr=[...localRules]; nr.find(r=>r.tempId===rule.tempId).price=e.target.value; setLocalRules(nr); setHasChanges(true); }} /></td>
                                                <td style={tdStyle}><button onClick={() => { setLocalRules(localRules.filter(r=>r.tempId !== rule.tempId)); setHasChanges(true); }} style={{ color: "red", background: "none", border: "none", cursor: "pointer" }}>Delete</button></td>
                                            </tr>
                                        ))}
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: "right", padding: "10px" }}>
                                                <s-button variant="secondary" onClick={() => addRule(variant.id)}>+ Add Tier</s-button>
                                            </td>
                                        </tr>
                                    </Fragment>
                                );
                            })
                        ) : (
                            <Fragment>
                                {localRules.map((rule, idx) => (
                                    <tr key={rule.tempId}>
                                        <td style={tdStyle}>All Variants (Combined)</td>
                                        <td style={tdStyle}>
                                            <AutocompleteSelect 
                                                value={rule.tag || ""} 
                                                availableTags={uniqueTags}
                                                onChange={(val) => { const nr=[...localRules]; nr.find(r=>r.tempId===rule.tempId).tag=val; setLocalRules(nr); setHasChanges(true); }}
                                            />
                                        </td>
                                        <td style={tdStyle}><input type="number" style={inputStyle} value={rule.minQuantity} onChange={(e) => { const nr = [...localRules]; nr.find(r=>r.tempId===rule.tempId).minQuantity=e.target.value; setLocalRules(nr); setHasChanges(true); }} /></td>
                                        <td style={tdStyle}>
                                            <select style={inputStyle} value={rule.discountType} onChange={(e) => { const nr=[...localRules]; nr.find(r=>r.tempId===rule.tempId).discountType=e.target.value; setLocalRules(nr); setHasChanges(true); }}>
                                                <option value="PERCENTAGE">Percentage OFF</option>
                                                <option value="FIXED_PRICE">Fixed Price</option>
                                            </select>
                                        </td>
                                        <td style={tdStyle}><input type="number" style={inputStyle} value={rule.price} onChange={(e) => { const nr=[...localRules]; nr.find(r=>r.tempId===rule.tempId).price=e.target.value; setLocalRules(nr); setHasChanges(true); }} /></td>
                                        <td style={tdStyle}><button onClick={() => { setLocalRules(localRules.filter(r=>r.tempId !== rule.tempId)); setHasChanges(true); }} style={{ color: "red", background: "none", border: "none", cursor: "pointer" }}>Delete</button></td>
                                    </tr>
                                ))}
                                <tr>
                                    <td colSpan={6} style={{ textAlign: "right", padding: "10px" }}>
                                        <s-button variant="secondary" onClick={() => addRule(null)}>+ Add Product Tier</s-button>
                                    </td>
                                </tr>
                            </Fragment>
                        )}
                    </tbody>
                </table>
            </div>
        </s-page>
      </>
    );
  }

  return <div>Invalid View</div>;
}

// --- STYLING ---
const cardStyle = { background: "white", padding: "35px", borderRadius: "16px", border: "1px solid #e1e1e1", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" as const, alignItems: "center", textAlign: "center" as const };
const cardIconStyle = { fontSize: "2.5em", marginBottom: "20px" };
const cardTitleStyle = { fontSize: "1.25em", fontWeight: "bold", marginBottom: "12px", color: "#202223" };
const cardDescStyle = { color: "#6d7175", fontSize: "0.95em", marginBottom: "25px", lineHeight: "1.4", flex: 1 };
const inputStyle = { padding: "8px", borderRadius: "6px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" as const };
const thStyle = { padding: "12px 15px" };
const tdStyle = { padding: "12px 15px" };
