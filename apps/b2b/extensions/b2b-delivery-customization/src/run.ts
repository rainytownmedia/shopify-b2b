import type { RunInput, FunctionRunResult } from "../generated/api";

/**
 * Checkout Rule structure saved by the app in `b2b_app.shipping_rules`
 */
interface Condition {
  type: "total_qty" | "total_amount" | "customer_tag";
  operator: "gte" | "lte" | "contains" | "not_contains";
  value: any;
}

interface CheckoutRule {
  id: string;
  name: string;
  matchType: "ANY" | "ALL";
  conditions: Condition[];
  targetMethods: string; // "all_paid", "all_payment", or comma-separated list
  status: string;
}

export function run(input: RunInput): FunctionRunResult {
  console.error("[B2B_DELIVERY] Function invoked");

  // 1. Get rules from shop metafield
  const rulesRaw = input.shop?.metafield?.value ?? null;
  if (!rulesRaw) {
    console.error("[B2B_DELIVERY] No shipping_rules found — passing through");
    return { operations: [] };
  }

  let rules: CheckoutRule[] = [];
  try {
    const parsed = JSON.parse(rulesRaw);
    rules = Array.isArray(parsed) ? parsed.filter((r: any) => r.status === "active") : [];
    console.error(`[B2B_DELIVERY] Parsed ${rules.length} active rules`);
  } catch {
    console.error(`[B2B_DELIVERY] Failed to parse shipping_rules JSON: ${rulesRaw}`);
    return { operations: [] };
  }

  if (!rules.length) {
    console.error("[B2B_DELIVERY] No active rules found");
    return { operations: [] };
  }

  // 2. Prepare cart data for comparison
  const subtotal = parseFloat(input.cart.cost.subtotalAmount.amount ?? "0");
  const lines = input.cart.lines ?? [];
  const totalQty = lines.reduce((acc, line) => acc + (line.quantity ?? 0), 0);
  
  // Get customer tags from synced metafield
  const customerMeta = input.cart.buyerIdentity?.customer?.metafield?.value;
  let customerTags: string[] = [];
  try {
    customerTags = customerMeta ? JSON.parse(customerMeta) : [];
  } catch {
    customerTags = [];
  }
  const customerTagsLower = customerTags.map(t => t.toLowerCase());

  console.error(`[B2B_DELIVERY] PROCESSING: Subtotal=${subtotal}, Qty=${totalQty}, Tags=${JSON.stringify(customerTagsLower)}`);

  // 3. Find matching rules
  const matchingRules = rules.filter(rule => {
    const conds = rule.conditions || [];
    console.error(`[B2B_DELIVERY] Checking rule: ${rule.name} with ${conds.length} conditions`);
    
    if (conds.length === 0) return false;

    const results = conds.map(cond => {
      const targetVal = cond.value;
      let matched = false;
      
      switch (cond.type) {
        case "total_qty": {
          const cartVal = totalQty;
          const ruleVal = parseInt(targetVal) || 0;
          matched = cond.operator === "gte" ? cartVal >= ruleVal : cartVal <= ruleVal;
          console.error(`  - Condition QTY: cart=${cartVal} ${cond.operator} rule=${ruleVal} => ${matched}`);
          break;
        }
        case "total_amount": {
          const cartVal = subtotal;
          const ruleVal = parseFloat(targetVal) || 0;
          matched = cond.operator === "gte" ? cartVal >= ruleVal : cartVal <= ruleVal;
          console.error(`  - Condition AMOUNT: cart=${cartVal} ${cond.operator} rule=${ruleVal} => ${matched}`);
          break;
        }
        case "customer_tag": {
          const tagToMatch = String(targetVal).toLowerCase();
          matched = customerTagsLower.includes(tagToMatch);
          if (cond.operator === "not_contains") matched = !matched;
          console.error(`  - Condition TAG: rule=${tagToMatch} match=${matched}`);
          break;
        }
      }
      return matched;
    });

    const finalMatch = rule.matchType === "ALL" ? results.every(res => res) : results.some(res => res);
    console.error(`[B2B_DELIVERY] Rule ${rule.name} Match Result: ${finalMatch}`);
    return finalMatch;
  });

  if (!matchingRules.length) {
    console.error("[B2B_DELIVERY] No rules matched the current cart/customer");
    return { operations: [] };
  }

  // 4. Determine which methods to hide
  const handlesToHide = new Set<string>();
  const deliveryGroups = input.cart.deliveryGroups ?? [];
  console.error(`[B2B_DELIVERY] Delivery Groups count: ${deliveryGroups.length}`);

  for (const rule of matchingRules) {
    const targets = rule.targetMethods || "";
    const isAllPaid = targets === "all_paid" || targets === "all_payment";
    const specificMethods = targets.split(",").map(m => m.trim().toLowerCase()).filter(Boolean);
    
    console.error(`[B2B_DELIVERY] Applying hide logic for rule ${rule.name}: targets=${targets}, isAllPaid=${isAllPaid}`);

    for (const group of deliveryGroups) {
      console.error(`  - Group has ${group.deliveryOptions.length} options`);
      for (const option of group.deliveryOptions) {
        const optionTitle = (option.title || "").toLowerCase();
        const optionCost = parseFloat(option.cost.amount || "0");

        let shouldHide = false;
        if (isAllPaid) {
          shouldHide = optionCost > 0;
        } else if (specificMethods.length > 0) {
          shouldHide = specificMethods.some(name => optionTitle.includes(name));
        }

        console.error(`    - Option: "${option.title}" Cost: ${optionCost} => ShouldHide=${shouldHide}`);

        if (shouldHide) {
          handlesToHide.add(option.handle);
        }
      }
    }
  }

  if (handlesToHide.size === 0) {
    console.error("[B2B_DELIVERY] No handles collected to hide");
    return { operations: [] };
  }

  const operations = Array.from(handlesToHide).map(handle => ({
    hide: { deliveryOptionHandle: handle }
  }));

  console.error(`[B2B_DELIVERY] Returning ${operations.length} hide operations: ${JSON.stringify(operations)}`);
  return { operations };
}

