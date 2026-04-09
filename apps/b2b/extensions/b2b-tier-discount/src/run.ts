import type {
  RunInput,
  FunctionRunResult,
  Target
} from "../generated/api";
import {
  DiscountApplicationStrategy,
} from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

export function run(input: RunInput): FunctionRunResult {
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
         console.error(`[B2B_DEBUG] Error parsing tags:`, e);
     }
  }
  console.error(`[B2B_DEBUG] Final tags: ${JSON.stringify(customerTags)}`);

  let discounts: any[] = []; 

  input.cart.lines.forEach((line) => {
    if (line.merchandise.__typename === "ProductVariant") {
      const merchandise = line.merchandise;
      const rulesStr = merchandise.product?.metafield?.value;
      console.error(`[B2B_DEBUG] CartLine: ${line.id} | Variant: ${merchandise.id} | Qty: ${line.quantity}`);
      if (!rulesStr) {
          console.error(`[B2B_DEBUG] No rules found for variant ${merchandise.id}`);
          return;
      }

      let rules: any[] = [];
      try {
        rules = JSON.parse(rulesStr);
        console.error(`[B2B_DEBUG] Parsed Rules: ${rulesStr}`);
      } catch (e) { 
        console.error(`[B2B_DEBUG] Error parsing rulesStr:`, e);
        return; 
      }

      const applicableRules = rules.filter(rule => {
         const matchesTag = customerTags.includes(rule.tag);
         const matchesVariant = !rule.variantId || rule.variantId === merchandise.id;
         const matchesQuantity = line.quantity >= rule.minQuantity;
         return matchesTag && matchesVariant && matchesQuantity;
      });

      if (applicableRules.length > 0) {
        const currentPrice = parseFloat((line.cost.amountPerQuantity as any).amount || "0");
        let bestRule: any = null;
        let lowestPrice = currentPrice;

        applicableRules.forEach(rule => {
            let targetPrice = currentPrice;
            if (rule.discountType === 'PERCENTAGE') {
                 targetPrice = currentPrice * (1 - parseFloat(rule.price) / 100);
            } else {
                 targetPrice = parseFloat(rule.price);
            }
            if (targetPrice < lowestPrice) {
                 lowestPrice = targetPrice;
                 bestRule = rule;
            }
        });

        if (bestRule && lowestPrice < currentPrice) {
            console.error(`[B2B_DEBUG] Match found! Best Rule: ${JSON.stringify(bestRule)} with lowest price: ${lowestPrice}`);
            let value;

            if (bestRule.discountType === 'PERCENTAGE') {
                 value = {
                     percentage: { value: parseFloat(bestRule.price).toFixed(2).toString() }
                 };
            } else {
                 const discountAmount = currentPrice - lowestPrice;
                 console.error(`[B2B_DEBUG] Fixed Amount calc: ${currentPrice} - ${lowestPrice} = ${discountAmount}`);
                 value = {
                     fixedAmount: {
                         amount: discountAmount.toFixed(2),
                         appliesToEachItem: true
                     }
                 };
            }

            discounts.push({
                targets: [
                    {
                        cartLine: { id: line.id }
                    }
                ],
                value: value,
                message: `Wholesale Applied`
            });
            console.error(`[B2B_DEBUG] Appended discount constraint to array`);
        } else {
            console.error(`[B2B_DEBUG] Applicable rules found but none provided a discount lower than current price.`);
        }
      } else {
        console.error(`[B2B_DEBUG] No matching rule for line ${line.id} (Checked ${rules.length} rules)`);
      }
    }
  });

  console.error(`[B2B_DEBUG] FINAL DISCOUNTS: ${JSON.stringify(discounts)}`);
  if (discounts.length === 0) {
      return EMPTY_DISCOUNT;
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.Maximum,
    discounts: discounts,
  };
};