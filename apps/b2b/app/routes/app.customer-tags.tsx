import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useNavigate, useActionData } from "react-router";
import { Page, Layout, Card, Text, Box, BlockStack, InlineStack, Button, Badge, DataTable, EmptyState, TextField, Modal, Divider, Banner, Tooltip } from "@shopify/polaris";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { Breadcrumbs } from "../components/Breadcrumbs";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // 1. Fetch all rules and existing metadata
  const [dbTags, priceLists, checkoutRules, cartDiscounts, regForm] = await Promise.all([
    (db as any).customerTag.findMany({ where: { shopId: session.shop } }),
    (db as any).priceList.findMany({ where: { shopId: session.shop }, select: { customerTag: true, name: true } }),
    (db as any).checkoutRule.findMany({ where: { shopId: session.shop }, select: { customerTag: true, name: true } }),
    (db as any).cartDiscount.findMany({ where: { shopId: session.shop }, select: { customerTag: true, name: true } }),
    (db as any).registrationForm.findFirst({ where: { shopId: session.shop }, select: { customerTags: true } })
  ]);

  // 2. Identify all unique tags currently in use across the app
  const usedTagsSet = new Set<string>();
  priceLists.forEach((p: any) => usedTagsSet.add(p.customerTag.trim()));
  checkoutRules.forEach((c: any) => { if(c.customerTag) usedTagsSet.add(c.customerTag.trim()) });
  cartDiscounts.forEach((d: any) => { if(d.customerTag) usedTagsSet.add(d.customerTag.trim()) });
  if (regForm?.customerTags) {
      regForm.customerTags.split(",").forEach((tag: string) => {
          const trimmed = tag.trim();
          if (trimmed) usedTagsSet.add(trimmed);
      });
  }

  // 3. AUTO-SYNC: If any used tag is missing from the database, create it automatically
  const existingTags = new Set(dbTags.map((t: any) => t.tag));
  const missingTags = Array.from(usedTagsSet).filter(tag => !existingTags.has(tag));

  if (missingTags.length > 0) {
      // Use $transaction for safety when creating missing tags
      await db.$transaction(
          missingTags.map(tag => (db as any).customerTag.upsert({
              where: { tag },
              update: {},
              create: { shopId: session.shop, tag, name: tag }
          }))
      );
      // Re-fetch dbTags after sync to ensure we have the full list
      const updatedDbTags = await (db as any).customerTag.findMany({ 
          where: { shopId: session.shop }, 
          orderBy: { createdAt: "asc" } 
      });
      return { 
          tagInventory: buildInventory(updatedDbTags, priceLists, checkoutRules, cartDiscounts) 
      };
  }

  return { 
      shopId: session.shop,
      tagInventory: buildInventory(dbTags, priceLists, checkoutRules, cartDiscounts) 
  };
};

// Helper to build the UI inventory object
function buildInventory(tags: any[], priceLists: any[], checkoutRules: any[], cartDiscounts: any[]) {
    return tags.map((t: any) => {
        const associatedPriceLists = priceLists.filter((p: any) => p.customerTag.trim() === t.tag);
        const associatedCheckoutRules = checkoutRules.filter((c: any) => c.customerTag?.trim() === t.tag);
        const associatedDiscounts = cartDiscounts.filter((d: any) => d.customerTag?.trim() === t.tag);
        
        return {
            tag: t.tag,
            tierName: t.name,
            tierId: t.id,
            tierDescription: t.description || "",
            pricingCount: associatedPriceLists.length,
            checkoutCount: associatedCheckoutRules.length,
            discountCount: associatedDiscounts.length,
            pricingNames: associatedPriceLists.map((p: any) => p.name),
            checkoutNames: associatedCheckoutRules.map((c: any) => c.name),
            discountNames: associatedDiscounts.map((d: any) => d.name)
        };
    });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  try {
    if (actionType === "saveTag") {
      const id = formData.get("id") as string;
      const tag = (formData.get("tag") as string)?.trim();
      const originalTag = (formData.get("originalTag") as string)?.trim();
      const description = formData.get("description") as string;
      const name = tag; 

      if (!tag) return { error: "Tag is required" };

      // 1. Handle Metadata & Uniqueness (Source of Truth)
      const existing = await (db as any).customerTag.findUnique({ where: { tag } });
      const hasId = id && id !== "null" && id !== "undefined" && id !== "";

      if (hasId) {
          const current = await (db as any).customerTag.findUnique({ where: { id } });
          if (!current) return { error: "Tag not found in database." };

          if (existing && existing.id !== id) {
              // MERGE CASE: Renaming 'tag,' to 'tag' where 'tag' already exists
              // Delete the old one and keep the existing one (merging metadata)
              await (db as any).customerTag.delete({ where: { id } });
          } else {
              // Standard Update
              await (db as any).customerTag.update({ where: { id }, data: { name, tag, description } });
          }
      } else {
          // CREATE CASE: If exists, return error to merchant instead of silent update
          if (existing) {
              return { error: `The tag "${tag}" already exists in your inventory.` };
          }
          await (db as any).customerTag.create({ data: { shopId: session.shop, name, tag, description } });
      }

      // 2. GLOBAL RENAME: Update all rule associations to the new tag name
      if (originalTag && tag !== originalTag) {
          await db.$transaction([
              (db as any).priceList.updateMany({ where: { shopId: session.shop, customerTag: originalTag }, data: { customerTag: tag } }),
              (db as any).checkoutRule.updateMany({ where: { shopId: session.shop, customerTag: originalTag }, data: { customerTag: tag } }),
              (db as any).cartDiscount.updateMany({ where: { shopId: session.shop, customerTag: originalTag }, data: { customerTag: tag } }),
          ]);

          const form = await (db as any).registrationForm.findFirst({ where: { shopId: session.shop } });
          if (form?.customerTags) {
              const tags = form.customerTags.split(",").map((t: string) => t.trim());
              const index = tags.indexOf(originalTag);
              if (index !== -1) {
                  tags[index] = tag;
                  await (db as any).registrationForm.update({ where: { id: form.id }, data: { customerTags: tags.join(", ") } });
              }
          }
      }
      return { success: true };
    }
    
    if (actionType === "deleteTag") {
        const id = formData.get("id") as string;
        await (db as any).customerTag.delete({ where: { id } });
        return { success: true };
    }
  } catch (error: any) {
    console.error("Action error:", error);
    return { error: error.message };
  }
  return { success: false };
};

export default function CustomerTagsPage() {
  const { tagInventory, shopId } = useLoaderData<typeof loader>();
  const actionData = useActionData<any>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<any>({ id: null, name: "", tag: "", description: "" });
  const [originalTag, setOriginalTag] = useState<string | null>(null);

  const handleCreateNew = () => {
      setEditingTag({ id: null, name: "", tag: "", description: "" });
      setOriginalTag(null);
      setIsModalOpen(true);
  };

  const handleEdit = (item: any) => {
      setEditingTag({
          id: item.tierId,
          name: item.tierName || item.tag,
          tag: item.tag,
          description: item.tierDescription || "" 
      });
      setOriginalTag(item.tag);
      setIsModalOpen(true);
  };

  const handleSave = () => {
    submit({ ...editingTag, originalTag: originalTag || "", actionType: "saveTag" }, { method: "POST" });
  };

  useEffect(() => {
    if (actionData?.success) {
        setIsModalOpen(false);
    }
  }, [actionData]);

  const handleDelete = (id: string) => {
      if (confirm("Are you sure you want to delete the metadata for this tag? This only removes information stored in the App, NOT the tag from Shopify or active rules.")) {
          submit({ id, actionType: "deleteTag" }, { method: "POST" });
      }
  };

  const rows = tagInventory.map((item) => {
    const isInUse = item.pricingCount > 0 || item.discountCount > 0 || item.checkoutCount > 0;
    
    const deleteButton = (
      <Button 
        size="slim" 
        tone="critical" 
        disabled={isInUse} 
        onClick={() => handleDelete(item.tierId!)}
      >
        Delete
      </Button>
    );

    return [
      <Text fontWeight="bold" as="span">{item.tag}</Text>,
      <BlockStack gap="100">
        {item.pricingCount > 0 && <Text as="p" variant="bodySm" tone="success">🏷️ {item.pricingCount} Price Lists</Text>}
        {item.discountCount > 0 && <Text as="p" variant="bodySm" tone="success">💸 {item.discountCount} Cart Discounts</Text>}
        {item.checkoutCount > 0 && <Text as="p" variant="bodySm" tone="success">🛒 {item.checkoutCount} Checkout Rules</Text>}
        {item.pricingCount === 0 && item.discountCount === 0 && item.checkoutCount === 0 && <Text as="p" variant="bodySm" tone="subdued">Not in use</Text>}
      </BlockStack>,
      <InlineStack gap="200">
        <Button size="slim" onClick={() => handleEdit(item)}>Edit</Button>
        {item.tierId && (
            isInUse ? (
                <Tooltip content="Cannot delete tag because it is in use by App rules">
                    {deleteButton}
                </Tooltip>
            ) : deleteButton
        )}
      </InlineStack>
    ];
  });

  const currentImpact = tagInventory.find((i: any) => i.tag === originalTag);

  return (
    <>
      <Breadcrumbs items={[{ label: "Customers & Onboarding", url: "/app/customer-management" }, { label: "Manage Tags" }]} />
      <div style={{ paddingTop: "15px" }}>
        <Page
          title="Customer Tags"
          subtitle="Complete list of all B2B tags used in your store rules."
          backAction={{ content: "Dashboard", onAction: () => navigate("/app/customer-management") }}
          primaryAction={{
            content: "Add New Tag",
            onAction: handleCreateNew,
          }}
        >
          <Layout>
            <Layout.Section>
              <Card>
                {tagInventory.length === 0 ? (
                  <EmptyState
                    heading="No Tags Found"
                    action={{ content: "Add your first tag", onAction: handleCreateNew }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Register your Shopify customer tags here to manage their B2B rules effectively.</p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Tag Value", "App Usage", "Actions"]}
                    rows={rows}
                  />
                )}
              </Card>
            </Layout.Section>
            
            <Layout.Section variant="oneThird">
                <BlockStack gap="400">
                    <Card>
                        <BlockStack gap="200">
                            <Text as="h2" variant="headingMd">Tag Audit</Text>
                            <Text as="p" variant="bodySm">This list scans all Price Lists, Registration Forms, Cart Discounts, and Checkout Rules to find every tag currently controlling your B2B logic.</Text>
                            <Divider />
                            <Text as="p" variant="bodySm">💡 Tip: Adding a tag here helps you track its usage across all app features.</Text>
                        </BlockStack>
                    </Card>
                </BlockStack>
            </Layout.Section>
          </Layout>

          <Modal
            open={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            title={editingTag.id ? "Edit Tag Metadata" : "Add New Tag"}
            primaryAction={{
              content: "Save",
              onAction: handleSave,
              loading: navigation.state === "submitting"
            }}
            secondaryActions={[{ content: "Cancel", onAction: () => setIsModalOpen(false) }]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                {actionData?.error && (
                    <Banner tone="critical" title="Save Failed">
                        <p>{actionData.error}</p>
                    </Banner>
                )}
                <TextField
                  label="Shopify Customer Tag"
                  value={editingTag.tag}
                  onChange={(val) => setEditingTag({ ...editingTag, tag: val })}
                  autoComplete="off"
                  helpText="This is the exact tag string used on Shopify customer profiles."
                  placeholder="e.g. wholesale-gold"
                />

                {(currentImpact && (currentImpact.pricingCount > 0 || currentImpact.checkoutCount > 0 || currentImpact.discountCount > 0) && editingTag.tag !== originalTag) && (
                    <Box padding="400" background="bg-surface-caution" borderRadius="200">
                        <BlockStack gap="200">
                            <Text as="h3" variant="headingSm" tone="caution">⚠️ Impact Warning</Text>
                            <Text as="p" variant="bodySm">You are changing searching for tag <strong>{originalTag}</strong>. This tag is used in:</Text>
                            <BlockStack gap="100">
                                {currentImpact.pricingNames.map((n: string) => <Text key={n} as="p" variant="bodySm">• Price List: {n}</Text>)}
                                {currentImpact.discountNames.map((n: string) => <Text key={n} as="p" variant="bodySm">• Cart Discount: {n}</Text>)}
                                {currentImpact.checkoutNames.map((n: string) => <Text key={n} as="p" variant="bodySm">• Checkout Rule: {n}</Text>)}
                            </BlockStack>
                            <Text as="p" variant="bodySm" tone="caution">Renaming the Shopify tag will disassociate these rules.</Text>
                        </BlockStack>
                    </Box>
                )}

                <TextField
                  label="Notes / Description (Optional)"
                  value={editingTag.description}
                  onChange={(val) => setEditingTag({ ...editingTag, description: val })}
                  autoComplete="off"
                  multiline={3}
                  placeholder="Internal notes about this tag..."
                />
              </BlockStack>
            </Modal.Section>
          </Modal>
        </Page>
      </div>
    </>
  );
}
