import type { RunInput, FunctionRunResult } from '../generated/api';

/**
 * Payment Rule Interface
 * Defines the structure of payment customization rules stored in shop metafield
 */
interface PaymentRule {
  id: string;
  name: string;
  matchType: 'ANY' | 'ALL';
  conditions: Condition[];
  targetMethods: string; // comma-separated list of payment methods
  customerTag?: string;
  status: string;
}

/**
 * Condition Interface
 * Each rule can have multiple conditions that must be evaluated
 */
interface Condition {
  type: 'total_qty' | 'total_amount' | 'customer_tag';
  operator: 'gte' | 'lte' | 'contains' | 'not_contains';
  value: string | number;
}

/**
 * Payment Operation (Shopify Functions output)
 * Defines which payment methods to hide from checkout
 */
interface PaymentOperation {
  hide: {
    paymentMethodId: string;
  };
}

/**
 * Main Shopify Function
 * Evaluates payment customization rules and returns operations to hide payment methods
 *
 * @param input - RunInput containing cart, customer, and shop data
 * @returns FunctionRunResult with hide operations for payment methods
 */
export function run(input: RunInput): FunctionRunResult {
  // 1. Parse payment_rules from shop metafield
  const paymentRulesJson = input.shop?.metafield?.value;
  if (!paymentRulesJson) {
    return { operations: [] };
  }

  let paymentRules: PaymentRule[] = [];
  try {
    paymentRules = JSON.parse(paymentRulesJson);
  } catch (error) {
    console.error('Failed to parse payment_rules:', error);
    return { operations: [] };
  }

  // 2. Get customer B2B tags
  const customerMetaValue = input.cart.buyerIdentity?.customer?.metafield?.value;
  let customerTags: string[] = [];
  if (customerMetaValue) {
    try {
      customerTags = JSON.parse(customerMetaValue);
      if (!Array.isArray(customerTags)) {
        customerTags = [];
      }
    } catch (error) {
      console.error('Failed to parse customer B2B tags:', error);
      customerTags = [];
    }
  }

  // 3. Get cart metrics
  const cartSubtotal = input.cart.cost?.subtotalAmount?.amount ?? 0;
  const totalQuantity = input.cart.lines?.reduce(
    (sum, line) => sum + (line.quantity ?? 0),
    0
  ) ?? 0;

  // 4. Filter active rules and evaluate conditions
  const matchingRules = paymentRules.filter(
    rule =>
      rule.status === 'active' &&
      evaluateRuleConditions(
        rule,
        customerTags,
        cartSubtotal,
        totalQuantity
      )
  );

  // 5. Collect payment methods to hide from matching rules
  // Each rule's targetMethods defines which payment methods to hide
  const methodsToHide = new Set<string>();
  for (const rule of matchingRules) {
    const targetMethods = rule.targetMethods
      .split(',')
      .map(m => m.trim().toLowerCase());

    // Add each target method to the hide list
    for (const method of targetMethods) {
      console.log(`[B2B-DEBUG] Evaluating target method: "${method}"`);
      
      if (method === 'all_payment') {
        console.log('[B2B-DEBUG] Hiding ALL payment methods');
        input.paymentMethods.forEach(pm => methodsToHide.add(pm.id));
      } else {
        // Find method by name match
        const matchingMethod = input.paymentMethods.find(pm => {
          const methodName = pm.name.toLowerCase();
          const target = method.toLowerCase();
          
          // Basic match
          if (methodName.includes(target) || target.includes(methodName)) return true;
          
          // Special mapping for common terms
          if (target === 'credit card' && (methodName.includes('bogus') || methodName.includes('stripe') || methodName.includes('authorize.net'))) {
            return true;
          }
          
          return false;
        });
        
        if (matchingMethod) {
          console.log(`[B2B-DEBUG] MATCH FOUND: "${matchingMethod.name}" (ID: ${matchingMethod.id})`);
          methodsToHide.add(matchingMethod.id);
        } else {
          console.log(`[B2B-DEBUG] NO MATCH for: "${method}"`);
        }
      }
    }
  }

  // 6. Generate hide operations for each matching method
  const operations: PaymentOperation[] = Array.from(methodsToHide).map(
    (paymentMethodName) => ({
      hide: { paymentMethodId: paymentMethodName },
    })
  );

  return { operations };
}

/**
 * Evaluates if a rule's conditions are met
 * Supports matchType: ANY (at least one condition matches) or ALL (all conditions must match)
 *
 * @param rule - Payment rule to evaluate
 * @param customerTags - Array of customer B2B tags
 * @param cartSubtotal - Cart subtotal amount
 * @param totalQuantity - Total quantity of items in cart
 * @returns true if rule conditions are satisfied
 */
function evaluateRuleConditions(
  rule: PaymentRule,
  customerTags: string[],
  cartSubtotal: number,
  totalQuantity: number
): boolean {
  if (!rule.conditions || rule.conditions.length === 0) {
    // If no conditions, rule always applies
    return true;
  }

  const conditionResults = rule.conditions.map(condition =>
    evaluateCondition(condition, customerTags, cartSubtotal, totalQuantity)
  );

  if (rule.matchType === 'ALL') {
    // All conditions must be true
    return conditionResults.every(result => result === true);
  } else {
    // ANY: at least one condition must be true (default behavior)
    return conditionResults.some(result => result === true);
  }
}

/**
 * Evaluates a single condition
 *
 * @param condition - Condition to evaluate
 * @param customerTags - Array of customer B2B tags
 * @param cartSubtotal - Cart subtotal amount
 * @param totalQuantity - Total quantity of items in cart
 * @returns true if condition is satisfied
 */
function evaluateCondition(
  condition: Condition,
  customerTags: string[],
  cartSubtotal: number,
  totalQuantity: number
): boolean {
  const { type, operator, value } = condition;

  switch (type) {
    case 'total_amount':
      return evaluateNumericCondition(cartSubtotal, operator, value);

    case 'total_qty':
      return evaluateNumericCondition(totalQuantity, operator, value);

    case 'customer_tag':
      return evaluateTagCondition(customerTags, operator, String(value));

    default:
      return false;
  }
}

/**
 * Evaluates numeric conditions (total_amount, total_qty)
 *
 * @param actualValue - Actual numeric value from cart
 * @param operator - Comparison operator ('gte' or 'lte')
 * @param conditionValue - Condition threshold value
 * @returns true if condition is satisfied
 */
function evaluateNumericCondition(
  actualValue: number,
  operator: string,
  conditionValue: string | number
): boolean {
  const threshold = Number(conditionValue);

  if (isNaN(threshold)) {
    return false;
  }

  switch (operator) {
    case 'gte':
      return actualValue >= threshold;
    case 'lte':
      return actualValue <= threshold;
    default:
      return false;
  }
}

/**
 * Evaluates tag conditions (customer_tag)
 *
 * @param customerTags - Array of customer tags
 * @param operator - Operator ('contains' or 'not_contains')
 * @param conditionValue - Tag value to check for
 * @returns true if condition is satisfied
 */
function evaluateTagCondition(
  customerTags: string[],
  operator: string,
  conditionValue: string
): boolean {
  const tagExists = customerTags.some(
    tag => tag.toLowerCase() === conditionValue.toLowerCase()
  );

  switch (operator) {
    case 'contains':
      return tagExists;
    case 'not_contains':
      return !tagExists;
    default:
      return false;
  }
}
