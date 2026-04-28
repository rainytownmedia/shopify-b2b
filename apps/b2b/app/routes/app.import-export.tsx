import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState, useCallback, useEffect } from "react";
import { useSubmit, useActionData, useNavigation, useLoaderData } from "react-router";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Box, Select, List, Icon, DropZone, DataTable, Tabs } from "@shopify/polaris";
import { NoteIcon, ExportIcon } from '@shopify/polaris-icons';
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { logActivity } from "../utils/logger.server";
import type { ImportExportLog } from "@prisma/client";

type ImportExportLogDelegate = {
  findMany: (args: unknown) => Promise<ImportExportLog[]>;
  create: (args: unknown) => Promise<ImportExportLog>;
};

function getImportExportLogDelegate(dbClient: unknown): ImportExportLogDelegate | null {
  const d = dbClient as { importExportLog?: unknown };
  const delegate = d?.importExportLog as Partial<ImportExportLogDelegate> | undefined;
  if (typeof delegate?.findMany === "function" && typeof delegate?.create === "function") {
    return delegate as ImportExportLogDelegate;
  }
  return null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const logDelegate = getImportExportLogDelegate(db);
  if (!logDelegate) {
    // Likely dev server running with old Prisma Client; avoid crashing the page.
    return { importLogs: [], exportLogs: [] };
  }

  const [importLogs, exportLogs] = await Promise.all([
    logDelegate.findMany({
      where: { shopId: session.shop, type: "IMPORT" },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    logDelegate.findMany({
      where: { shopId: session.shop, type: "EXPORT" },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return { importLogs, exportLogs };
};

import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const startedAt = Date.now();
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const file = formData.get("file") as File;
  const dataType = formData.get("dataType") as string;
  const actionType = (formData.get("actionType") as string) || "import";

  if (actionType !== "import") {
    return { error: "Unsupported action" };
  }

  if (!file) {
    return { error: "No file provided" };
  }

  try {
    const text = await file.text();
    // Basic CSV parser (assuming no quotes/commas inside values for simplicity right now)
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    // const headers = lines[0].split(","); // reserved for future validation
    
    let processedCount = 0;

    if (dataType === 'tier_pricing_variant') {
       const productCache = new Map<string, string>();
       const { admin } = await authenticate.admin(request);
       
       // Headers: Product Handle,Variant ID,Variant SKU,Customer Tag,Min Quantity,Discount Type (PERCENTAGE/FIXED_PRICE),Value
       for (let i = 1; i < lines.length; i++) {
         const cols = lines[i].split(",");
         if (cols.length < 7) continue;
         
         const [, variantId, , tag, minQtyStr, discountType, valStr] = cols;
         const minQty = parseInt(minQtyStr, 10);
         const val = parseFloat(valStr);

         if (isNaN(minQty) || isNaN(val) || !variantId || !tag) continue;

         // Fetch parent Product ID if not cached
         const fullVariantGid = `gid://shopify/ProductVariant/${variantId}`;
         let productId = productCache.get(variantId);
         
         if (!productId) {
            try {
              const vRes = await admin.graphql(
                `#graphql
                 query getVariant($id: ID!) {
                   productVariant(id: $id) {
                     product { id }
                   }
                 }`,
                { variables: { id: fullVariantGid } }
              );
              const vJson = await vRes.json();
              productId = vJson.data?.productVariant?.product?.id;
              if (productId) productCache.set(variantId, productId);
            } catch (e) {
              console.error("GraphQL error fetching variant product id:", e);
            }
         }

         if (!productId) continue; // Skip if we still couldn't find the product ID

         // Ensure PriceList exists
        const listName = `Tier List - ${tag}`;
         let priceList = await db.priceList.findFirst({
           where: { shopId: session.shop, customerTag: tag, category: "TIER" }
         });

         if (!priceList) {
           priceList = await db.priceList.create({
             data: { shopId: session.shop, name: listName, customerTag: tag, category: "TIER" }
           });
         }

         // Create/Update Item
         await db.priceListItem.create({
           data: {
             priceListId: priceList.id,
             productId: productId,
             variantId: fullVariantGid,
             minQuantity: minQty,
             discountType: discountType || "PERCENTAGE",
             price: val
           }
         });
         processedCount++;
       }
    } else if (dataType === 'tier_pricing_product') {
       // Headers: Product ID,Product Handle,Customer Tag,Min Quantity,Discount Type (PERCENTAGE/FIXED_PRICE),Value
       for (let i = 1; i < lines.length; i++) {
         const cols = lines[i].split(",");
         if (cols.length < 6) continue;
         
         const [productId, , tag, minQtyStr, discountType, valStr] = cols;
         const minQty = parseInt(minQtyStr, 10);
         const val = parseFloat(valStr);

         if (isNaN(minQty) || isNaN(val) || !productId || !tag) continue;

         let priceList = await db.priceList.findFirst({
           where: { shopId: session.shop, customerTag: tag, category: "TIER" }
         });

         if (!priceList) {
           priceList = await db.priceList.create({
             data: { shopId: session.shop, name: `Tier List - ${tag}`, customerTag: tag, category: "TIER" }
           });
         }

         await db.priceListItem.create({
           data: {
             priceListId: priceList.id,
             productId: `gid://shopify/Product/${productId}`,
             minQuantity: minQty,
             discountType: discountType || "PERCENTAGE",
             price: val
           }
         });
         processedCount++;
       }
    }

    const logDelegate = getImportExportLogDelegate(db);
    if (logDelegate) {
      await logDelegate.create({
        data: {
          shopId: session.shop,
          type: "IMPORT",
          dataType: String(dataType),
          status: "SUCCESS",
          filename: file?.name || "import.csv",
          mimeType: file?.type || "text/csv",
          rowCount: processedCount,
          content: text,
        },
      });
    }

    await logActivity({
      shopId: session.shop,
      action: `IMPORT_${String(dataType).toUpperCase()}`,
      method: "POST",
      path: new URL(request.url).pathname,
      statusCode: 200,
      requestData: { dataType, filename: file?.name },
      responseData: { processedCount },
      duration: Date.now() - startedAt,
    });

    return { success: true, count: processedCount };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to parse CSV";
    try {
      const logDelegate = getImportExportLogDelegate(db);
      if (logDelegate) {
        await logDelegate.create({
          data: {
            shopId: session.shop,
            type: "IMPORT",
            dataType: String(dataType),
            status: "FAILED",
            filename: file?.name || "import.csv",
            mimeType: file?.type || "text/csv",
            rowCount: 0,
            error: message,
            content: "",
          },
        });
      }
    } catch {
      // ignore logging failures
    }
    await logActivity({
      shopId: session.shop,
      action: `IMPORT_${String(dataType).toUpperCase()}`,
      method: "POST",
      path: new URL(request.url).pathname,
      statusCode: 500,
      requestData: { dataType, filename: file?.name },
      responseData: { error: message },
      duration: Date.now() - startedAt,
    });
    return { error: message };
  }
};

export default function ImportExport() {
  const { importLogs, exportLogs } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  
  const isImporting = navigation.state === "submitting" && navigation.formData?.has("file");

  const [importType, setImportType] = useState('tier_pricing_variant');
  const [exportType, setExportType] = useState('tier_pricing_variant');
  const [file, setFile] = useState<File | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [historyTabIndex, setHistoryTabIndex] = useState(0);

  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        shopify.toast.show(`Successfully imported ${actionData.count} rows!`);
        setFile(null); // Reset file after success
      } else if (actionData.error) {
        shopify.toast.show(`Error: ${actionData.error}`, { isError: true });
      }
    }
  }, [actionData, shopify]);

  const dataTypeOptions = [
    { label: 'Tier Pricing (Individual Variants)', value: 'tier_pricing_variant' },
    { label: 'Tier Pricing (Product Level)', value: 'tier_pricing_product' },
  ];

  const handleImportTypeChange = useCallback((value: string) => setImportType(value), []);
  const handleExportTypeChange = useCallback((value: string) => setExportType(value), []);

  const handleDropZoneDrop = useCallback(
    (_dropFiles: File[], acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) setFile(acceptedFiles[0]);
    },
    [],
  );

  const handleStartImport = () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("dataType", importType);
    formData.append("actionType", "import");
    
    // Using multipart/form-data to strictly handle file uploads
    submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  const downloadLogFile = async (logId: string) => {
    try {
      const downloadUrl = `/api/import-export-logs/${encodeURIComponent(logId)}/download`;
      const res = await fetch(downloadUrl, {
        method: "GET",
        credentials: "same-origin",
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Download failed (${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || "export.csv";

      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = filename;
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      shopify.toast.show(`Download error: ${message}`, { isError: true });
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const exportUrl = `/api/export-tier-pricing?dataType=${encodeURIComponent(exportType)}`;
      const res = await fetch(exportUrl, {
        method: "GET",
        headers: { Accept: "text/csv" },
        credentials: "same-origin",
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Export failed (${res.status})`);
      }

      const blob = await res.blob();

      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename =
        match?.[1] ||
        (exportType === "tier_pricing_variant"
          ? "tier_pricing_variants.csv"
          : "tier_pricing_products.csv");

      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = filename;
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);

      shopify.toast.show("Export started");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      shopify.toast.show(`Export error: ${message}`, { isError: true });
    } finally {
      setIsExporting(false);
    }
  };

  const downloadTemplate = (type: string) => {
    let content = "";
    let filename = "";

    switch (type) {
      case 'tier_pricing_variant':
        content = "Product Handle,Variant ID,Variant SKU,Customer Tag,Min Quantity,Discount Type (PERCENTAGE/FIXED_PRICE),Value\nexample-product,456789123,,VIP,5,PERCENTAGE,10";
        filename = "tier_pricing_variants_template.csv";
        break;
      case 'tier_pricing_product':
        content = "Product ID,Product Handle,Customer Tag,Min Quantity,Discount Type (PERCENTAGE/FIXED_PRICE),Value\n123456789,example-product,VIP,10,FIXED_PRICE,50";
        filename = "tier_pricing_products_template.csv";
        break;
    }

    if (content) {
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <Page 
      title="Import / Export"
      subtitle="Bulk manage your B2B Customer Tags, Price Lists, and Rules."
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Import Data</Text>
              <Text as="p" variant="bodyMd">
                Upload a CSV file to bulk create or update your B2B configuration. Select the data type you are importing before uploading your file.
              </Text>

              <Select
                label="Data Type to Import"
                options={dataTypeOptions}
                onChange={handleImportTypeChange}
                value={importType}
              />

              <DropZone onDrop={handleDropZoneDrop} allowMultiple={false} accept=".csv, text/csv">
                {file ? (
                  <div style={{ padding: "30px", textAlign: "center" }}>
                    <BlockStack align="center" inlineAlign="center" gap="200">
                       <Icon source={NoteIcon} tone="base" />
                       <Text as="p" variant="bodyMd" fontWeight="semibold">{file.name}</Text>
                       <Text as="p" variant="bodySm" tone="subdued">{Math.round(file.size / 1024)} KB</Text>
                       <Button variant="plain" onClick={() => setFile(null)}>Remove file</Button>
                    </BlockStack>
                  </div>
                ) : (
                  <DropZone.FileUpload actionHint="Accepts .csv" />
                )}
              </DropZone>

              <InlineStack align="end" gap="200">
                <Button variant="primary" onClick={handleStartImport} disabled={!file} loading={isImporting}>Start Import</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Export Data</Text>
              <Text as="p" variant="bodyMd">
                Download your current B2B setup for backup or migration.
              </Text>
              
              <Select
                label="Data Type to Export"
                options={dataTypeOptions}
                onChange={handleExportTypeChange}
                value={exportType}
              />

              <Box paddingBlockStart="200">
                <Button
                  fullWidth
                  variant="secondary"
                  icon={ExportIcon}
                  onClick={handleExport}
                  loading={isExporting}
                  disabled={isExporting}
                >
                  Export CSV
                </Button>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
           <Card>
                <BlockStack gap="400">
                    <div>
                        <Text as="h2" variant="headingMd">CSV Templates</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Download sample files to ensure your data is formatted correctly before importing.</Text>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                       <BlockStack gap="200">
                          <Text as="h3" variant="headingSm">Tier Pricing</Text>
                          <List type="bullet">
                              <List.Item><Button variant="plain" onClick={() => downloadTemplate('tier_pricing_variant')}>Tier Pricing (Variants) Template</Button></List.Item>
                              <List.Item><Button variant="plain" onClick={() => downloadTemplate('tier_pricing_product')}>Tier Pricing (Products) Template</Button></List.Item>
                          </List>
                       </BlockStack>
                    </div>
                </BlockStack>
           </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <div>
                <Text as="h2" variant="headingMd">History</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Recent imports and exports for this shop.
                </Text>
              </div>

              <Tabs
                tabs={[{ id: "import", content: "Import" }, { id: "export", content: "Export" }]}
                selected={historyTabIndex}
                onSelect={setHistoryTabIndex}
              >
                <Box paddingBlockStart="300">
                  {historyTabIndex === 0 ? (
                    <DataTable
                      columnContentTypes={["text", "text", "numeric", "text", "text", "text"]}
                      headings={["File", "Data type", "Rows", "Status", "Time", "Download"]}
                      rows={(importLogs || []).map((h: ImportExportLog) => {
                        const time = h.createdAt ? new Date(h.createdAt).toLocaleString() : "";
                        return [
                          String(h.filename || ""),
                          String(h.dataType || ""),
                          h.rowCount ?? "",
                          h.status || "",
                          time,
                          <Button key={h.id} variant="plain" onClick={() => downloadLogFile(h.id)}>
                            Download
                          </Button>,
                        ];
                      })}
                    />
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "numeric", "text", "text", "text"]}
                      headings={["File", "Data type", "Rows", "Status", "Time", "Download"]}
                      rows={(exportLogs || []).map((h: ImportExportLog) => {
                        const time = h.createdAt ? new Date(h.createdAt).toLocaleString() : "";
                        return [
                          String(h.filename || ""),
                          String(h.dataType || ""),
                          h.rowCount ?? "",
                          h.status || "",
                          time,
                          <Button key={h.id} variant="plain" onClick={() => downloadLogFile(h.id)}>
                            Download
                          </Button>,
                        ];
                      })}
                    />
                  )}
                </Box>
              </Tabs>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
