import db from "../db.server";
import { PLANS, PLAN_FREE } from "../config/plans.config";

export async function checkUsage(shopId: string) {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { maxRowLimit: true, displayGbLimit: true }
  });

  const maxRowLimit = shop?.maxRowLimit ?? PLANS[PLAN_FREE].maxRowLimit;
  const displayGbLimit = shop?.displayGbLimit ?? PLANS[PLAN_FREE].displayGbLimit;

  // Count PriceListItems (Tiers & Wholesale Offers)
  const priceItemsCount = await db.priceListItem.count({
    where: { priceList: { shopId } }
  });

  // Count Cart Discounts
  const cartDiscountsCount = await db.cartDiscount.count({
    where: { shopId }
  });

  // Count Checkout Rules
  const checkoutRulesCount = await db.checkoutRule.count({
    where: { shopId }
  });

  const totalRows = priceItemsCount + cartDiscountsCount + checkoutRulesCount;
  
  // Calculate Gb
  const currentGb = parseFloat(((totalRows / maxRowLimit) * displayGbLimit).toFixed(2));
  
  const isLimitReached = totalRows >= maxRowLimit;
  const isWarning = totalRows >= maxRowLimit * 0.9 && !isLimitReached; // 90%
  
  return {
    totalRows,
    maxRowLimit,
    currentGb,
    displayGbLimit,
    isLimitReached,
    isWarning,
  };
}
