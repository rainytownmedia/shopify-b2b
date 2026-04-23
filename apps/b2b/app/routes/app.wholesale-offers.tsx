import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useNavigation, useBlocker } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkUsage } from "../utils/quota.server";
import { getComboboxTagOptions } from "../utils/customer-tags.server";
import React from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Banner } from "@shopify/polaris";
import { TagCombobox } from "../components/TagCombobox";

/**
 * SYNC HELPER
 * Aggregates all rules (Wholesale & Tier) for a list of products and syncs to Shopify Metafields
 */
async function syncProductsMetafields(admin: any, shopId: string, productIds: string[]) {
  if (productIds.length === 0) return;

  // 1. Get collection memberships for these products to check for collection-based rules
  const pCollRes = await admin.graphql(
    `#graphql
    query getProductCollections($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          collections(first: 50) {
            edges { node { id } }
          }
        }
      }
    }`,
    { variables: { ids: productIds } }
  );
  
  const pCollJson: any = await pCollRes.json();
  const productCollectionMap: Record<string, string[]> = {};
  const allRelatedCollectionIds = new Set<string>();

  pCollJson.data?.nodes?.forEach((node: any) => {
    if (node) {
      const cIds = node.collections?.edges.map((e: any) => e.node.id) || [];
      productCollectionMap[node.id] = cIds;
      cIds.forEach((id: string) => allRelatedCollectionIds.add(id));
    }
  });

  // 2. Fetch all relevant rules from DB (Product-specific + Collection-specific)
  const [productRules, collectionRules] = await Promise.all([
    db.priceListItem.findMany({
      where: { 
        productId: { in: productIds },
        priceList: { shopId: shopId }
      },
      include: { priceList: true }
    }),
    db.priceListItem.findMany({
      where: { 
        collectionId: { in: Array.from(allRelatedCollectionIds) },
        priceList: { shopId: shopId }
      },
      include: { priceList: true }
    })
  ]);

  // 3. Format metafield values per product
  const productMetafields = productIds.map(pId => {
    const directRules = productRules.filter(r => r.productId === pId);
    
    // Get rules from collections this product belongs to
    const productColls = productCollectionMap[pId] || [];
    const relatedCollRules = collectionRules.filter(r => r.collectionId && productColls.includes(r.collectionId));

    // Combined rules for the "tier_rules" metafield
    const combinedRules = [...directRules, ...relatedCollRules].map(r => ({
      tag: r.priceList.customerTag,
      variantId: r.variantId, // Might be null for collection rules, which is handled in run.ts
      minQuantity: r.minQuantity,
      discountType: r.discountType,
      price: parseFloat(r.price.toString())
    }));

    return {
      ownerId: pId,
      namespace: "b2b_app",
      key: "tier_rules",
      type: "json",
      value: JSON.stringify(combinedRules)
    };
  });

  // 4. Batch sync to Shopify
  const chunkSize = 25;
  for (let i = 0; i < productMetafields.length; i += chunkSize) {
    const chunk = productMetafields.slice(i, i + chunkSize);
    const response = await admin.graphql(
      `#graphql
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      { variables: { metafields: chunk } }
    );
    const result = await response.json();
    if (result.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error("Metafield Sync Error:", result.data.metafieldsSet.userErrors);
    }
  }
}

/**
 * LOADER
 * Fetches all necessary data: Products, Collections, and existing PriceLists (Offers)
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("query") || "";
  const offerId = url.searchParams.get("offerId");

  let products: any[] = [];
  let collections: any[] = [];

  try {
    const [pLists, pItems, uniqueTags] = await Promise.all([
      db.priceList.findMany({
        where: { shopId: session.shop, category: "WHOLESALE" },
        include: { items: true },
        orderBy: { updatedAt: 'desc' }
      }),
      db.priceListItem.findMany({
        where: { priceList: { shopId: session.shop, category: "WHOLESALE" } }
      }),
      getComboboxTagOptions(session.shop)
    ]);

    // Fetch product/collection titles if editing an existing offer
    if (offerId && offerId !== "new") {
      const offerItems = pItems.filter((i: any) => i.priceListId === offerId);
      const uniqueProductIds = Array.from(new Set(offerItems.map((i: any) => i.productId).filter(Boolean)));
      if (uniqueProductIds.length > 0) {
        const pRes = await admin.graphql(
          `#graphql
           query getProductsByIds($ids: [ID!]!) {
             nodes(ids: $ids) { ... on Product { id title } }
           }`,
          { variables: { ids: uniqueProductIds } }
        );
        const pJson: any = await pRes.json();
        products = pJson.data?.nodes?.filter(Boolean).map((node: any) => ({ node })) || [];
      }
      const uniqueCollectionIds = Array.from(new Set(offerItems.map((i: any) => i.collectionId).filter(Boolean)));
      if (uniqueCollectionIds.length > 0) {
        const cRes = await admin.graphql(
          `#graphql
           query getCollectionsByIds($ids: [ID!]!) {
             nodes(ids: $ids) { ... on Collection { id title } }
           }`,
          { variables: { ids: uniqueCollectionIds } }
        );
        const cJson: any = await cRes.json();
        collections = cJson.data?.nodes?.filter(Boolean).map((node: any) => ({ node })) || [];
      }
    }

    const usage = await checkUsage(session.shop);
    return { products, collections, priceLists: pLists, priceItems: pItems, searchTerm, usage, uniqueTags };
  } catch (error) {
    console.error("Loader fetch error:", error);
    return { products: [], collections: [], priceLists: [], priceItems: [], searchTerm, error: "Network or API error", uniqueTags: ["ALL"] };
  }
};

/**
 * ACTION
 * Handles Create, Update, and Delete operations for named Offers (PriceLists)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  try {
    if (actionType === "saveBulkOffer") {
      const offerId = formData.get("offerId") as string;
      const offerName = formData.get("offerName") as string;
      const customerTag = formData.get("customerTag") as string;
      const selectedProductIds = JSON.parse(formData.get("productIds") as string || "[]");
      const selectedCollectionIds = JSON.parse(formData.get("collectionIds") as string || "[]");
      const rules = JSON.parse(formData.get("rules") as string);

      const itemsToCreate: any[] = [];
      
      // Add Product items
      selectedProductIds.forEach((pId: string) => {
        rules.forEach((rule: any) => {
          itemsToCreate.push({
            productId: pId,
            minQuantity: parseInt(rule.minQuantity),
            discountType: rule.discountType,
            price: parseFloat(rule.price)
          });
        });
      });

      // Add Collection items
      selectedCollectionIds.forEach((cId: string) => {
        rules.forEach((rule: any) => {
          itemsToCreate.push({
            collectionId: cId,
            minQuantity: parseInt(rule.minQuantity),
            discountType: rule.discountType,
            price: parseFloat(rule.price)
          });
        });
      });
      // Check Quota
      const usage = await checkUsage(session.shop);
      let netIncrease = itemsToCreate.length;
      if (offerId !== "new") {
        const currentItemCount = await db.priceListItem.count({ where: { priceListId: offerId } });
        netIncrease -= currentItemCount;
      }
      if (netIncrease > 0 && usage.totalRows + netIncrease > usage.maxRowLimit) {
         return { error: `Storage Limit Exceeded! You are trying to add ${netIncrease} new rules, but you only have ${usage.maxRowLimit - usage.totalRows} slots left.` };
      }

      if (offerId === "new") {
        await db.priceList.create({
          data: {
            shopId: session.shop,
            name: offerName,
            customerTag: customerTag,
            category: "WHOLESALE",
            items: { create: itemsToCreate }
          }
        });
      } else {
        await db.$transaction([
          db.priceList.update({
            where: { id: offerId },
            data: { name: offerName, customerTag: customerTag }
          }),
          db.priceListItem.deleteMany({ where: { priceListId: offerId } }),
          db.priceListItem.createMany({
            data: itemsToCreate.map(item => ({ ...item, priceListId: offerId }))
          })
        ]);
      }

      // --- SYNC TO METAFIELDS ---
      let productIdsToSync = [...selectedProductIds];
      
      // If collection offers, fetch all products in those collections
      for (const collectionId of selectedCollectionIds) {
        const response = await admin.graphql(
          `#graphql
          query getProductsInCollection($id: ID!) {
            collection(id: $id) {
              products(first: 250) {
                edges { node { id } }
              }
            }
          }`,
          { variables: { id: collectionId } }
        );
        const result: any = await response.json();
        const pIds = result.data?.collection?.products?.edges.map((e: any) => e.node.id) || [];
        productIdsToSync = Array.from(new Set([...productIdsToSync, ...pIds]));
      }

      await syncProductsMetafields(admin, session.shop, productIdsToSync);
      // --------------------------

    } else if (actionType === "deleteOffer") {
      const offerId = formData.get("offerId") as string;
      
      // Find affected products before deleting
      const affectedItems = await db.priceListItem.findMany({
        where: { priceListId: offerId },
        select: { productId: true, collectionId: true }
      });

      let productIdsToSync = affectedItems.map(i => i.productId).filter(Boolean) as string[];
      const collectionIds = affectedItems.map(i => i.collectionId).filter(Boolean) as string[];

      for (const collectionId of collectionIds) {
        const response = await admin.graphql(
          `#graphql
          query getProductsInCollection($id: ID!) {
            collection(id: $id) {
              products(first: 250) {
                edges { node { id } }
              }
            }
          }`,
          { variables: { id: collectionId } }
        );
        const result: any = await response.json();
        const pIds = result.data?.collection?.products?.edges.map((e: any) => e.node.id) || [];
        productIdsToSync = Array.from(new Set([...productIdsToSync, ...pIds]));
      }

      await db.priceList.delete({ where: { id: offerId } });
      
      // Sync after delete to clear rules
      await syncProductsMetafields(admin, session.shop, productIdsToSync);
    }
  } catch (error: any) {
    console.error("Action error:", error);
    return { error: error.message };
  }
  return { success: true };
};

export default function WholesaleOffersPage() {
  const { products: fetchedProducts, collections: fetchedCollections, priceLists, priceItems, searchTerm, usage, uniqueTags } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigation = useNavigation();

  // Navigation state management
  const mode = searchParams.get("mode"); // 'product', 'collection'
  const offerId = searchParams.get("offerId"); // 'new', or UUID
  
  // Builder state (Figure 2 Form)
  const [offerName, setOfferName] = useState("");
  const [customerTag, setCustomerTag] = useState("ALL");
  const [selectedEntries, setSelectedEntries] = useState<any[]>([]); // Array of {id, title}
  const [rules, setRules] = useState<any[]>([{ tempId: 'initial', minQuantity: 1, discountType: 'PERCENTAGE', price: 0 }]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    setIsNavigating(false);
  }, [offerId, priceLists, fetchedProducts, mode]);

  const isActionLoading = isNavigating || navigation.state !== "idle" || fetcher.state !== "idle";

  const handleNavigate = (newParams: URLSearchParams) => {
    setIsNavigating(true);
    setSearchParams(newParams);
  };

  // Sync state when editing existing offer
  useEffect(() => {
    if (offerId && offerId !== "new") {
      const offer = priceLists.find((l: any) => l.id === offerId);
      if (offer) {
        setOfferName(offer.name);
        setCustomerTag(offer.customerTag);
        setRules(offer.items.map((i: any, idx: number) => ({ ...i, tempId: `rule-${idx}` })));
        
        if (mode === 'collection') {
            const uniqueCollectionIds = Array.from(new Set(offer.items.map((i: any) => i.collectionId).filter(Boolean)));
            setSelectedEntries(uniqueCollectionIds.map(id => ({ 
                id, 
                title: fetchedCollections.find((c:any) => c.node.id === id)?.node.title || "Selected Collection" 
            })));
        } else {
            const uniqueProductIds = Array.from(new Set(offer.items.map((i: any) => i.productId).filter(Boolean)));
            setSelectedEntries(uniqueProductIds.map(id => ({ 
                id, 
                title: fetchedProducts.find((p:any) => p.node.id === id)?.node.title || "Selected Product" 
            })));
        }
        
        setHasChanges(false);
      }
    } else if (offerId === "new") {
      setOfferName("");
      setCustomerTag("ALL");
      setSelectedEntries([]);
      setRules([{ tempId: Date.now(), minQuantity: 1, discountType: 'PERCENTAGE', price: 0 }]);
      setHasChanges(false);
    }
  }, [offerId, priceLists, fetchedProducts, fetchedCollections, mode]);

  // Shopify Resource Picker
  const handleSelectEntries = async () => {
    const selected = await shopify.resourcePicker({ 
        type: mode === 'collection' ? 'collection' : 'product', 
        multiple: true,
        selectionIds: selectedEntries.map(e => ({ id: e.id }))
    });
    if (selected) {
      const formatted = selected.map(p => ({ id: p.id, title: p.title }));
      setSelectedEntries(formatted);
      setHasChanges(true);
    }
  };

  const saveOffer = () => {
    if (!offerName || !customerTag || selectedEntries.length === 0) {
      shopify.toast.show(`Please fill in Offer Name, Customer Tag and select ${mode === 'collection' ? 'Collections' : 'Products'}`, { isError: true });
      return;
    }
    const payload: any = {
      actionType: "saveBulkOffer",
      offerId: offerId || "new",
      offerName,
      customerTag,
      rules: JSON.stringify(rules)
    };

    if (mode === 'collection') {
        payload.collectionIds = JSON.stringify(selectedEntries.map(e => e.id));
    } else {
        payload.productIds = JSON.stringify(selectedEntries.map(e => e.id));
    }

    fetcher.submit(payload, { method: "POST" });
    setHasChanges(false);
    shopify.toast.show(`Offer for ${mode === 'collection' ? 'Collections' : 'Products'} saved successfully`);
    // Go back to list
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("offerId");
    setSearchParams(nextParams);
  };

  const deleteOffer = (id: string) => {
    if (confirm("Are you sure you want to delete this offer?")) {
      fetcher.submit({ actionType: "deleteOffer", offerId: id }, { method: "POST" });
    }
  };

  // --- RENDERING HELPERS ---

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

  const renderUsageBanner = () => {
    if (!usage) return null;
    if (usage.isLimitReached) {
       return (
         <div style={{ marginBottom: "20px" }}>
           <Banner tone="critical" title="Storage Limit Reached">
             You have used all {usage.maxRowLimit} allowed rules ({usage.currentGb} GB). You cannot add new offers until you <a href="/app/pricing"><strong>upgrade your plan</strong></a>.
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

  /**
   * DASHBOARD (Figure 1)
   */
  if (!mode && !offerId) {
    return (
      <>
        <Breadcrumbs items={[{ label: "Wholesale Offers" }]} />
        <s-page heading="Wholesale Offers Dashboard" back-action-url="/app">
          {renderLoadingOverlay()}
          {renderUsageBanner()}
          {/* Guide Banner */}
          <div style={{ background: "#fff9db", padding: "16px", borderRadius: "12px", border: "1px solid #ffe066", marginBottom: "30px", display: "flex", alignItems: "center", gap: "15px" }}>
             <span style={{ fontSize: "1.5em" }}>🏷️</span>
             <div style={{ fontSize: "0.95em", color: "#856404", lineHeight: "1.5" }}>
                <strong>Wholesale Guide:</strong> Create bulk offers that apply across <strong>multiple items or entire collections</strong>. Perfect for rewarding loyal customers with global discounts.
             </div>
          </div>

          {/* Action Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "25px" }}>
              <div style={cardStyle}>
                  <div style={cardIconStyle}>🛍️</div>
                  <h2 style={cardTitleStyle}>Offer for Catalog & Products</h2>
                  <p style={cardDescStyle}>Create broad wholesale rules that apply to specific products or across your entire shop's catalog.</p>
                  <s-button variant="primary" onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.set("mode", "product");
                      handleNavigate(next);
                  }}>Manage Product Offers</s-button>
              </div>
              <div style={cardStyle}>
                  <div style={cardIconStyle}>📚</div>
                  <h2 style={cardTitleStyle}>Offer for Collections</h2>
                  <p style={cardDescStyle}>Rule applies instantly to all current and future products within a specific Shopify Collection.</p>
                  <s-button variant="primary" onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.set("mode", "collection");
                      handleNavigate(next);
                  }}>Manage Collection Offers</s-button>
              </div>
          </div>
        </s-page>
      </>
    );
  }

  /**
   * OFFER LIST VIEW (Products or Collections)
   */
  if ((mode === "product" || mode === "collection") && !offerId) {
    const filteredOffers = priceLists.filter((offer: any) => {
        const item = priceItems.find((i: any) => i.priceListId === offer.id);
        if (mode === "collection") return item?.collectionId !== null;
        return item?.productId !== null;
    });

    return (
      <>
        <Breadcrumbs items={[{ label: "Wholesale Offers", url: "/app/wholesale-offers" }, { label: mode === "collection" ? "Collection Offers" : "Product Offers" }]} />
        <s-page heading={mode === "collection" ? "Collection Wholesale Offers" : "Product Wholesale Offers"} back-action-url="/app/wholesale-offers">
            {renderLoadingOverlay()}
            {renderUsageBanner()}
            <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between" }}>
                <s-button variant="secondary" onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("mode");
                    handleNavigate(next);
                }}>← Back to Dashboard</s-button>
                <s-button variant="primary" disabled={usage?.isLimitReached} onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.set("offerId", "new");
                    handleNavigate(next);
                }}>+ Create New Offer</s-button>
            </div>

            <div style={{ background: "white", borderRadius: "12px", border: "1px solid #ddd", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ textAlign: "left", background: "#f9f9f9" }}>
                            <th style={thStyle}>Offer Name</th>
                            <th style={thStyle}>Customer Tag</th>
                            <th style={thStyle}>{mode === "collection" ? "Collections" : "Products"}</th>
                            <th style={thStyle}>Last Updated</th>
                            <th style={thStyle}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOffers.map((offer: any) => (
                            <tr key={offer.id} style={{ borderBottom: "1px solid #eee" }}>
                                <td style={tdStyle}><strong>{offer.name}</strong></td>
                                <td style={tdStyle}><span style={tagStyle}>{offer.customerTag}</span></td>
                                <td style={tdStyle}>{priceItems.filter((i:any) => i.priceListId === offer.id).length} {mode === "collection" ? "collections" : "products"}</td>
                                <td style={tdStyle}>{new Date(offer.updatedAt).toLocaleDateString()}</td>
                                <td style={tdStyle}>
                                    <div style={{ display: "flex", gap: "10px" }}>
                                        <s-button variant="secondary" onClick={() => {
                                            const next = new URLSearchParams(searchParams);
                                            next.set("offerId", offer.id);
                                            handleNavigate(next);
                                        }}>Edit</s-button>
                                        <button onClick={() => deleteOffer(offer.id)} style={{ color: "#d32f2f", background: "none", border: "none", cursor: "pointer" }}>Delete</button>
                                    </div>
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

  /**
   * BULK OFFER BUILDER (Figure 2 Form)
   */
  if (offerId) {
    const typeLabel = mode === 'collection' ? 'Collection' : 'Wholesale';
    const offer = priceLists.find((l: any) => l.id === offerId);
    const breadcrumbLabel = offerId === "new" ? `New Offer` : (offer?.name || "Edit Offer");

    return (
      <>
        <Breadcrumbs items={[
          { label: "Wholesale Offers", url: "/app/wholesale-offers" }, 
          { label: mode === "collection" ? "Collection Offers" : "Product Offers", url: `/app/wholesale-offers?mode=${mode}` },
          { label: breadcrumbLabel }
        ]} />
        <s-page heading={offerId === "new" ? `Create New ${typeLabel} Offer` : `Edit ${typeLabel} Offer`} back-action-url={`/app/wholesale-offers?mode=${mode}`}>
            {renderLoadingOverlay()}
            {renderUsageBanner()}
            <div style={{ marginBottom: "25px" }}>
                <s-button variant="secondary" onClick={() => {
                    if (hasChanges && !confirm("Discard unsaved changes?")) return;
                    const next = new URLSearchParams(searchParams);
                    next.delete("offerId");
                    handleNavigate(next);
                }}>← Back to Offers</s-button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "25px" }}>
                {/* 1. Offer Name */}
                <div style={formCardStyle}>
                    <label style={labelStyle}>Offer Name</label>
                    <p style={subLabelStyle}>Internal name for your reference only</p>
                    <input 
                        type="text" 
                        value={offerName} 
                        onChange={(e) => { setOfferName(e.target.value); setHasChanges(true); }} 
                        style={inputStyle} 
                        placeholder="e.g. VIP Summer Discount" 
                    />
                </div>

                {/* 2. Offer Details (Rules) */}
                <div style={formCardStyle}>
                    <label style={labelStyle}>Offer Details</label>
                    <table style={{ width: "100%", marginTop: "15px", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ textAlign: "left", background: "#f8f8f8" }}>
                                <th style={thSmallStyle}>Min Quantity</th>
                                <th style={thSmallStyle}>Discount Type</th>
                                <th style={thSmallStyle}>Value</th>
                                <th style={thSmallStyle}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.map((rule, idx) => (
                                <tr key={rule.tempId} style={{ borderBottom: "1px solid #eee" }}>
                                    <td style={tdStyle}>
                                        <input type="number" style={inputStyle} value={rule.minQuantity} onChange={(e) => {
                                            const nr = [...rules]; nr[idx].minQuantity = e.target.value; setRules(nr); setHasChanges(true);
                                        }} />
                                    </td>
                                    <td style={tdStyle}>
                                        <select style={inputStyle} value={rule.discountType} onChange={(e) => {
                                            const nr = [...rules]; nr[idx].discountType = e.target.value; setRules(nr); setHasChanges(true);
                                        }}>
                                            <option value="PERCENTAGE">Percent OFF</option>
                                            <option value="FIXED_PRICE">Fixed Price</option>
                                        </select>
                                    </td>
                                    <td style={tdStyle}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                            <input type="number" style={inputStyle} value={rule.price} onChange={(e) => {
                                                const nr = [...rules]; nr[idx].price = e.target.value; setRules(nr); setHasChanges(true);
                                            }} />
                                            <span>{rule.discountType === 'PERCENTAGE' ? '%' : '$'}</span>
                                        </div>
                                    </td>
                                    <td style={tdStyle}>
                                        <button onClick={() => { setRules(rules.filter(r => r.tempId !== rule.tempId)); setHasChanges(true); }} style={{ color: "grey", background: "none", border: "none", cursor: "pointer" }}>🗑️</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div style={{ marginTop: "15px", textAlign: "right" }}>
                        <s-button variant="secondary" onClick={() => setRules([...rules, { tempId: Date.now(), minQuantity: 1, discountType: 'PERCENTAGE', price: 0 }])}>+ Add Price Rule</s-button>
                    </div>
                </div>

                {/* 3. Apply Discount To (Products/Collections) */}
                <div style={formCardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={labelStyle}>Apply Discount To</label>
                        <s-button variant="secondary" onClick={handleSelectEntries}>
                            {mode === 'collection' ? "Add Collections" : "Add Products"}
                        </s-button>
                    </div>
                    <div style={{ marginTop: "15px", display: "flex", flexWrap: "wrap", gap: "10px" }}>
                        {selectedEntries.length === 0 ? (
                            <p style={{ color: "#aaa", fontSize: "0.9em" }}>
                                No {mode === 'collection' ? "collections" : "products"} selected. 
                                Click "Add {mode === 'collection' ? "Collections" : "Products"}" to select.
                            </p>
                        ) : (
                            selectedEntries.map(entry => (
                                <div key={entry.id} style={selectedItemTagStyle}>
                                    {entry.title}
                                    <span onClick={() => setSelectedEntries(selectedEntries.filter(e => e.id !== entry.id))} style={{ marginLeft: "8px", cursor: "pointer", fontWeight: "bold" }}>×</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* 4. Customer Tag Combobox */}
                <div style={formCardStyle}>
                    <label style={labelStyle}>Customer Tag</label>
                    <p style={subLabelStyle}>Offer will only apply to customers with this tag</p>
                    <div style={{ marginTop: "10px" }}>
                      <TagCombobox
                        value={customerTag || "ALL"}
                        onChange={(val) => { setCustomerTag(val); setHasChanges(true); }}
                        availableTags={uniqueTags?.length ? uniqueTags : ["ALL"]}
                      />
                    </div>
                </div>

                {/* Save Footer */}
                <div style={{ background: "white", padding: "20px", borderRadius: "12px", border: "1px solid #ddd", textAlign: "right" }}>
                    <s-button variant="primary" onClick={saveOffer} disabled={usage?.isLimitReached && offerId === "new"}>SAVE OFFER</s-button>
                </div>
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

const formCardStyle = { background: "white", padding: "24px", borderRadius: "12px", border: "1px solid #ddd" };
const labelStyle = { fontSize: "1.1em", fontWeight: "bold", color: "#202223", display: "block" };
const subLabelStyle = { fontSize: "0.9em", color: "#6d7175", marginTop: "4px" };
const inputStyle = { padding: "10px", borderRadius: "8px", border: "1px solid #ccc", width: "100%", marginTop: "10px", boxSizing: "border-box" as const };
const thStyle = { padding: "15px", borderBottom: "1px solid #eee" };
const tdStyle = { padding: "12px 15px" };
const thSmallStyle = { padding: "10px 15px", fontSize: "0.85em", color: "#6d7175" };
const tagStyle = { background: "#eee", padding: "4px 8px", borderRadius: "4px", fontSize: "0.85em", fontWeight: "bold" };
const selectedItemTagStyle = { background: "#f0f0f0", padding: "6px 12px", borderRadius: "20px", display: "flex", alignItems: "center", fontSize: "0.9em", border: "1px solid #ddd" };
