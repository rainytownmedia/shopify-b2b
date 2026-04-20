import type {
  RunInput,
  FunctionRunResult,
} from "../generated/api";
import {
  DiscountApplicationStrategy,
} from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

export function run(input: RunInput): FunctionRunResult {
  // 1. Get Customer Tags
  let customerTagsStr = input.cart.buyerIdentity?.customer?.metafield?.value;
  let customerTags: string[] = ["ALL"]; 
  if (customerTagsStr) {
     try {
       const parsed = JSON.parse(customerTagsStr);
       if (Array.isArray(parsed)) {
           customerTags = [...customerTags, ...parsed];
       } else if (typeof parsed === 'string') {
           customerTags.push(parsed);
       }
     } catch (e) {
         console.error(`[B2B_CART_DEBUG] Error parsing customer tags:`, e);
     }
  }

  // 2. Get Cart subtotal
  const subtotal = parseFloat(input.cart.cost.subtotalAmount.amount);
  console.error(`[B2B_CART_DEBUG] Subtotal: ${subtotal} | Tags: ${JSON.stringify(customerTags)}`);

  // 3. Get Cart Rules from Shop Metafield
  const cartRulesStr = input.shop.metafield?.value;
  if (!cartRulesStr) {
    console.error(`[B2B_CART_DEBUG] No cart rules found in shop metafield.`);
    return EMPTY_DISCOUNT;
  }

  let rules: any[] = [];
  try {
    rules = JSON.parse(cartRulesStr);
  } catch (e) {
    console.error(`[B2B_CART_DEBUG] Error parsing shop cart rules:`, e);
    return EMPTY_DISCOUNT;
  }

  // 4. Find the best applicable rule
  let bestRule: any = null;
  let highestDiscountValue = 0;

  rules.forEach(rule => {
    const matchesTag = customerTags.includes(rule.tag);
    const meetsMinimum = subtotal >= rule.minSubtotal;

    if (matchesTag && meetsMinimum) {
        // For simplicity, we compare Percentage or Fixed value. 
        // In a real scenario, you'd calculate which one gives more discount.
        // Here we just pick the one with highest 'value' property if it's the same type
        if (!bestRule || rule.value > highestDiscountValue) {
            bestRule = rule;
            highestDiscountValue = rule.value;
        }
    }
  });

  if (bestRule) {
    console.error(`[B2B_CART_DEBUG] Match found! Applying cart discount: ${bestRule.name}`);
    
    let value;
    if (bestRule.discountType === 'PERCENTAGE') {
        value = {
            percentage: { value: bestRule.value.toFixed(2).toString() }
        };
    } else {
        value = {
            fixedAmount: {
                amount: bestRule.value.toFixed(2).toString()
            }
        };
    }

    return {
      discountApplicationStrategy: DiscountApplicationStrategy.First,
      discounts: [
        {
          // @ts-ignore: Bypassing local typegen mismatch for Order Discount schema
          targets: [
            {
              orderSubtotal: {
                excludedVariantIds: []
              }
            }
          ],
          value: value,
          message: bestRule.name || "B2B Discount"
        }
      ]
    };
  }

  console.error(`[B2B_CART_DEBUG] No applicable cart rules for this subtotal/customer.`);
  return EMPTY_DISCOUNT;
}
