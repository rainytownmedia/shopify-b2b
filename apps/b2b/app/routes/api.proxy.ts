import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";

import { logActivity } from "../utils/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startTime = Date.now();
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const productId = url.searchParams.get("product_id");
  const customerTagsString = url.searchParams.get("tags") || "";
  const customerTags = customerTagsString.split(",").map(tag => tag.trim());
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  if (!shop || !productId) {
    const errorResponse = { error: "Missing parameters" };
    await logActivity({
      shopId: shop || "unknown",
      action: "API_PROXY_ERROR",
      method: "GET",
      path: url.pathname + url.search,
      statusCode: 400,
      requestData: { productId, customerTagsString },
      responseData: errorResponse,
      duration: Date.now() - startTime,
      ip
    });
    return new Response(JSON.stringify(errorResponse), { 
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const collectionIdsString = url.searchParams.get("collection_ids") || "";
  const collectionIds = collectionIdsString.split(",").map(id => id.trim()).filter(id => id !== "");

  // Find price lists for this shop that match either TIER generally or WHOLESALE by customer tag
  const matchedPriceLists = await db.priceList.findMany({
    where: {
      shopId: shop,
      OR: [
        { category: "TIER", customerTag: { in: [...customerTags, "ALL"] } },
        { category: "WHOLESALE", customerTag: { in: customerTags } }
      ]
    },
    include: {
      items: {
        where: {
          OR: [
            { productId: productId },
            { collectionId: { in: collectionIds } }
          ]
        }
      }
    }
  });

  // Extract wholesale items
  const wholesaleItems = matchedPriceLists
    .filter(list => list.category === "WHOLESALE")
    .flatMap(list => list.items.map((item: any) => ({
      ...item,
      priceListTag: list.customerTag
    })))
    .filter((item: any) => item.price !== null);

  // Extract tier items
  const tierItems = matchedPriceLists
    .filter(list => list.category === "TIER")
    .flatMap(list => list.items.map((item: any) => ({
      ...item,
      priceListTag: list.customerTag
    })))
    .filter((item: any) => item.price !== null);

  const responseData = {
    hasWholesalePrice: wholesaleItems.length > 0 || tierItems.length > 0,
    wholesaleRules: wholesaleItems.map((item: any) => ({
      variantId: item.variantId,
      minQuantity: item.minQuantity,
      discountType: item.discountType,
      price: item.price,
      tag: item.priceListTag
    })),
    tierRules: tierItems.map((item: any) => ({
      variantId: item.variantId,
      minQuantity: item.minQuantity,
      discountType: item.discountType,
      price: item.price,
      tag: item.priceListTag
    }))
  };

  // Log the successful request
  await logActivity({
    shopId: shop,
    action: "API_PROXY_SUCCESS",
    method: "GET",
    path: url.pathname + url.search,
    statusCode: 200,
    requestData: { productId, customerTags, collectionIds },
    responseData: responseData,
    duration: Date.now() - startTime,
    ip
  });

  return responseData;
};
