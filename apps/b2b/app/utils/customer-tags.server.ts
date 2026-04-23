import db from "../db.server";

/**
 * Collect every tag string referenced in B2B app rule tables.
 * Use this to keep the customer_tags table aligned with real config (no per-screen Admin API call).
 */
export async function collectUsedTagStrings(shopId: string): Promise<Set<string>> {
  const [priceLists, checkoutRules, cartDiscounts, regForms, orderLimits] = await Promise.all([
    db.priceList.findMany({ where: { shopId }, select: { customerTag: true } }),
    db.checkoutRule.findMany({ where: { shopId }, select: { customerTag: true } }),
    db.cartDiscount.findMany({ where: { shopId }, select: { customerTag: true } }),
    db.registrationForm.findMany({ where: { shopId }, select: { customerTags: true } }),
    db.orderLimit.findMany({ where: { shopId }, select: { customerTag: true } }),
  ]);
  const used = new Set<string>();
  for (const p of priceLists) {
    if (p.customerTag?.trim()) used.add(p.customerTag.trim());
  }
  for (const c of checkoutRules) {
    if (c.customerTag?.trim()) used.add(c.customerTag.trim());
  }
  for (const d of cartDiscounts) {
    if (d.customerTag?.trim()) used.add(d.customerTag.trim());
  }
  for (const f of regForms) {
    if (f.customerTags) {
      for (const t of f.customerTags.split(",")) {
        if (t.trim()) used.add(t.trim());
      }
    }
  }
  for (const o of orderLimits) {
    if (o.customerTag?.trim()) used.add(o.customerTag.trim());
  }
  return used;
}

async function upsertMissingTagsForShop(shopId: string, used: Set<string>): Promise<void> {
  const existingRows = await db.customerTag.findMany({ where: { shopId }, select: { tag: true } });
  const existing = new Set(existingRows.map((r) => r.tag));
  const missing = [...used].filter((tag) => !existing.has(tag));
  for (const tag of missing) {
    try {
      await db.customerTag.upsert({
        where: { tag },
        update: {},
        create: { shopId, tag, name: tag },
      });
    } catch (e) {
      console.warn(`upsertMissingTagsForShop: could not upsert tag "${tag}"`, e);
    }
  }
}

/**
 * Create customer_tags rows when a tag appears in rules (same behavior as the Manage tags screen).
 * Prisma upsert uses { tag }; tag is globally unique in the schema (pre-existing design).
 */
export async function syncCustomerTagInventory(shopId: string): Promise<void> {
  const used = await collectUsedTagStrings(shopId);
  await upsertMissingTagsForShop(shopId, used);
}

/**
 * Combobox options: ALL first, then merge tags in use from rules and manual customer_tags metadata rows.
 * Does not call the Admin customers API; fast and consistent across screens.
 */
export async function getComboboxTagOptions(shopId: string): Promise<string[]> {
  const used = await collectUsedTagStrings(shopId);
  await upsertMissingTagsForShop(shopId, used);
  for (const r of await db.customerTag.findMany({ where: { shopId }, select: { tag: true } })) {
    if (r.tag?.trim()) used.add(r.tag.trim());
  }
  if (!used.has("ALL")) used.add("ALL");

  const rest = [...used]
    .filter((t) => t !== "ALL")
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return ["ALL", ...rest];
}
