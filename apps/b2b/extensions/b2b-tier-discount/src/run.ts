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
         // Silently fail
     }
  }

  let discounts: any[] = []; 

  input.cart.lines.forEach((line) => {
    if (line.merchandise.__typename === "ProductVariant") {
      const merchandise = line.merchandise;
      const rulesStr = merchandise.product?.metafield?.value;
      if (!rulesStr) return;

      let rules: any[] = [];
      try {
        rules = JSON.parse(rulesStr);
      } catch (e) { return; }

      const applicableRules = rules.filter(rule => {
         const matchesTag = customerTags.includes(rule.tag);
         const matchesVariant = !rule.variantId || rule.variantId === merchandise.id;
         const matchesQuantity = line.quantity >= rule.minQuantity;
         return matchesTag && matchesVariant && matchesQuantity;
      });

      if (applicableRules.length > 0) {
        applicableRules.sort((a, b) => b.minQuantity - a.minQuantity);
        const bestRule = applicableRules[0];

        let value;
        if (bestRule.discountType === 'PERCENTAGE') {
             value = {
                 percentage: { value: parseFloat(bestRule.price).toString() }
             };
        } else {
             const currentPrice = parseFloat((line.cost.amountPerQuantity as any).amount || "0");
             const targetPrice = parseFloat(bestRule.price);
             if (currentPrice > targetPrice) {
                 const discountAmount = currentPrice - targetPrice;
                 value = {
                     fixedAmount: {
                         amount: discountAmount.toString(),
                         appliesToEachItem: true
                     }
                 };
             } else {
                 return; 
             }
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
      }
    }
  });

  if (discounts.length === 0) {
      return EMPTY_DISCOUNT;
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.Maximum,
    discounts: discounts,
  };
};