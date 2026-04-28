import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logActivity } from "../utils/logger.server";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
type AdminApi = { graphql: AdminGraphql };

interface VariantNode {
  id: string;
  sku?: string | null;
  product?: { handle?: string | null } | null;
}

interface ProductNode {
  id: string;
  handle?: string | null;
}

interface PriceListRef {
  customerTag?: string | null;
}

interface PriceListItemRow {
  productId: string | null;
  variantId: string | null;
  minQuantity: number | null;
  discountType: string | null;
  price: number | null;
  priceList?: PriceListRef | null;
}

function escapeCsvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function gidToNumericId(gid: string | null | undefined): string {
  if (!gid) return "";
  const parts = gid.split("/");
  return parts[parts.length - 1] || "";
}

async function fetchVariantDetails(
  admin: AdminApi,
  variantGids: string[],
): Promise<Map<string, { sku: string; productHandle: string }>> {
  const out = new Map<string, { sku: string; productHandle: string }>();
  if (variantGids.length === 0) return out;

  const chunkSize = 100;
  for (let i = 0; i < variantGids.length; i += chunkSize) {
    const chunk = variantGids.slice(i, i + chunkSize);
    const res = await admin.graphql(
      `#graphql
      query VariantNodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            sku
            product { handle }
          }
        }
      }`,
      { variables: { ids: chunk } },
    );
    const json = (await res.json()) as { data?: { nodes?: Array<VariantNode | null> } };
    const nodes = json.data?.nodes || [];
    for (const n of nodes) {
      if (!n?.id) continue;
      out.set(n.id, {
        sku: n.sku || "",
        productHandle: n.product?.handle || "",
      });
    }
  }
  return out;
}

async function fetchProductHandles(
  admin: AdminApi,
  productGids: string[],
): Promise<Map<string, { handle: string }>> {
  const out = new Map<string, { handle: string }>();
  if (productGids.length === 0) return out;

  const chunkSize = 100;
  for (let i = 0; i < productGids.length; i += chunkSize) {
    const chunk = productGids.slice(i, i + chunkSize);
    const res = await admin.graphql(
      `#graphql
      query ProductNodes($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            handle
          }
        }
      }`,
      { variables: { ids: chunk } },
    );
    const json = (await res.json()) as { data?: { nodes?: Array<ProductNode | null> } };
    const nodes = json.data?.nodes || [];
    for (const n of nodes) {
      if (!n?.id) continue;
      out.set(n.id, { handle: n.handle || "" });
    }
  }
  return out;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const startedAt = Date.now();
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const dataType = url.searchParams.get("dataType");

  if (dataType !== "tier_pricing_variant" && dataType !== "tier_pricing_product") {
    return new Response("Invalid export type", { status: 400 });
  }

  let filename = "";
  try {
    const items = (await db.priceListItem.findMany({
      where: {
        priceList: { shopId: session.shop, category: "TIER" },
        variantId: dataType === "tier_pricing_variant" ? { not: null } : null,
      },
      include: { priceList: true },
      orderBy: [{ productId: "asc" }, { variantId: "asc" }, { minQuantity: "asc" }],
    })) as unknown as PriceListItemRow[];

    let csv = "";

    if (dataType === "tier_pricing_variant") {
      const variantGids = Array.from(new Set(items.map((i) => i.variantId).filter(Boolean))) as string[];
      const detailsByVariantId = await fetchVariantDetails(admin, variantGids);

      const header = [
        "Product Handle",
        "Variant ID",
        "Variant SKU",
        "Customer Tag",
        "Min Quantity",
        "Discount Type (PERCENTAGE/FIXED_PRICE)",
        "Value",
      ].join(",");

      const rows = items.map((i) => {
        const d = i.variantId ? detailsByVariantId.get(i.variantId) : undefined;
        return [
          escapeCsvCell(d?.productHandle || ""),
          escapeCsvCell(gidToNumericId(i.variantId)),
          escapeCsvCell(d?.sku || ""),
          escapeCsvCell(i.priceList?.customerTag || ""),
          escapeCsvCell(i.minQuantity ?? ""),
          escapeCsvCell(i.discountType || "PERCENTAGE"),
          escapeCsvCell(i.price ?? ""),
        ].join(",");
      });

      csv = [header, ...rows].join("\n");
    } else {
      const productGids = Array.from(new Set(items.map((i) => i.productId).filter(Boolean))) as string[];
      const handlesByProductId = await fetchProductHandles(admin, productGids);

      const header = [
        "Product ID",
        "Product Handle",
        "Customer Tag",
        "Min Quantity",
        "Discount Type (PERCENTAGE/FIXED_PRICE)",
        "Value",
      ].join(",");

      const rows = items.map((i) => {
        const handle = i.productId ? handlesByProductId.get(i.productId)?.handle || "" : "";
        return [
          escapeCsvCell(gidToNumericId(i.productId)),
          escapeCsvCell(handle),
          escapeCsvCell(i.priceList?.customerTag || ""),
          escapeCsvCell(i.minQuantity ?? ""),
          escapeCsvCell(i.discountType || "PERCENTAGE"),
          escapeCsvCell(i.price ?? ""),
        ].join(",");
      });

      csv = [header, ...rows].join("\n");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    filename =
      dataType === "tier_pricing_variant"
        ? `tier_pricing_variants_${timestamp}.csv`
        : `tier_pricing_products_${timestamp}.csv`;

    await db.importExportLog.create({
      data: {
        shopId: session.shop,
        type: "EXPORT",
        dataType,
        status: "SUCCESS",
        filename,
        mimeType: "text/csv",
        rowCount: items.length,
        content: csv,
      },
    });

    await logActivity({
      shopId: session.shop,
      action: `EXPORT_${dataType.toUpperCase()}`,
      method: "GET",
      path: new URL(request.url).pathname,
      statusCode: 200,
      requestData: { dataType },
      responseData: { rows: items.length, filename },
      duration: Date.now() - startedAt,
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Export failed";
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const failedFilename =
        dataType === "tier_pricing_variant"
          ? `tier_pricing_variants_${timestamp}.csv`
          : `tier_pricing_products_${timestamp}.csv`;
      await db.importExportLog.create({
        data: {
          shopId: session.shop,
          type: "EXPORT",
          dataType: String(dataType),
          status: "FAILED",
          filename: failedFilename,
          mimeType: "text/csv",
          rowCount: 0,
          error: message,
          content: "",
        },
      });
    } catch {
      // ignore logging failures
    }
    await logActivity({
      shopId: session.shop,
      action: `EXPORT_${String(dataType).toUpperCase()}`,
      method: "GET",
      path: new URL(request.url).pathname,
      statusCode: 500,
      requestData: { dataType },
      responseData: { error: message, filename },
      duration: Date.now() - startedAt,
    });
    return new Response(message, { status: 500 });
  }
};

