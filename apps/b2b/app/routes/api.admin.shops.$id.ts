import { data as dataResponse } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { requireAdminAuth } from "../services/admin.auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminAuth(request);
  const shopId = params.id;

  if (!shopId) {
    return dataResponse({ error: "Shop ID is required" }, { status: 400 });
  }

  const shop = await db.shop.findUnique({
    where: { id: shopId }
  });

  if (!shop) {
    return dataResponse({ error: "Shop not found" }, { status: 404 });
  }

  // Get usage statistics
  const [priceListsCount, cartDiscountsCount, checkoutRulesCount] = await Promise.all([
     db.priceList.count({ where: { shopId } }),
     db.cartDiscount.count({ where: { shopId } }),
     db.checkoutRule.count({ where: { shopId } })
  ]);

  return dataResponse({
    data: {
      ...shop,
      usage: {
        priceLists: priceListsCount,
        cartDiscounts: cartDiscountsCount,
        checkoutRules: checkoutRulesCount,
        totalRules: priceListsCount + cartDiscountsCount + checkoutRulesCount
      }
    }
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdminAuth(request);
  const shopId = params.id;

  if (!shopId) {
    return dataResponse({ error: "Shop ID is required" }, { status: 400 });
  }

  const formData = await request.json();
  const { status, plan, maxRowLimit, displayGbLimit } = formData;

  const updatedShop = await db.shop.update({
    where: { id: shopId },
    data: {
      status,
      plan,
      maxRowLimit,
      displayGbLimit
    }
  });

  return dataResponse({ data: updatedShop });
}
