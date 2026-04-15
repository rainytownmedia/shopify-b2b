import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Debug endpoint: /api/cart-discount-debug
 * Shows current state of cart discount setup:
 *   - shop metafields (cart_rules, cart_discount_gid)
 *   - available shopify functions
 *   - existing automatic discounts
 *
 * REMOVE THIS ROUTE BEFORE PRODUCTION.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // 1. Get shop info + metafields
  const shopRes = await admin.graphql(`#graphql
    query {
      shop {
        id
        name
        cartRulesMeta: metafield(namespace: "b2b_app", key: "cart_rules") {
          value
          updatedAt
        }
        discountGidMeta: metafield(namespace: "b2b_app", key: "cart_discount_gid") {
          value
          updatedAt
        }
      }
    }
  `);
  const shopJson: any = await shopRes.json();
  const shop = shopJson.data?.shop;

  // 2. List available shopify functions
  const funcRes = await admin.graphql(`#graphql
    query {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
          app { handle title }
        }
      }
    }
  `);
  const funcJson: any = await funcRes.json();
  const functions = funcJson.data?.shopifyFunctions?.nodes ?? [];

  // 3. List existing automatic discounts
  const discountRes = await admin.graphql(`#graphql
    query {
      automaticDiscountNodes(first: 10) {
        nodes {
          id
          automaticDiscount {
            ... on DiscountAutomaticApp {
              title
              status
              startsAt
              endsAt
              appDiscountType {
                functionId
                title
              }
            }
          }
        }
      }
    }
  `);
  const discountJson: any = await discountRes.json();
  const discounts = discountJson.data?.automaticDiscountNodes?.nodes ?? [];

  const result = {
    shop: {
      id: shop?.id,
      name: shop?.name,
    },
    metafields: {
      cart_rules: {
        value: shop?.cartRulesMeta?.value
          ? JSON.parse(shop.cartRulesMeta.value)
          : null,
        updatedAt: shop?.cartRulesMeta?.updatedAt ?? null,
      },
      cart_discount_gid: {
        value: shop?.discountGidMeta?.value ?? null,
        updatedAt: shop?.discountGidMeta?.updatedAt ?? null,
      },
    },
    shopifyFunctions: functions.map((f: any) => ({
      id: f.id,
      title: f.title,
      apiType: f.apiType,
      app: f.app?.handle,
    })),
    automaticDiscounts: discounts.map((d: any) => ({
      id: d.id,
      title: d.automaticDiscount?.title,
      status: d.automaticDiscount?.status,
      startsAt: d.automaticDiscount?.startsAt,
      functionId: d.automaticDiscount?.appDiscountType?.functionId,
    })),
    diagnosis: {
      hasCartRules: !!shop?.cartRulesMeta?.value,
      hasDiscountGid: !!shop?.discountGidMeta?.value,
      cartDiscountFunctionFound: functions.some(
        (f: any) =>
          f.apiType === "order_discounts" &&
          (f.title?.toLowerCase().includes("cart") ||
            f.app?.handle?.includes("b2b"))
      ),
      automaticDiscountExists: discounts.some((d: any) =>
        d.automaticDiscount?.appDiscountType?.functionId
          ?.toLowerCase()
          .includes("cart")
      ),
    },
  };

  return new Response(JSON.stringify(result, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
};
