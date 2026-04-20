import type {
    RunInput,
    FunctionRunResult,
} from "../generated/api";

const EMPTY_RESULT: FunctionRunResult = {
    operations: []
};

export function run(input: RunInput): FunctionRunResult {
    // 1. Get Customer Tags
    const customerTagsStr = input.cart.buyerIdentity?.customer?.metafield?.value;
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
            console.error(`[B2B_PAYMENT_DEBUG] Error parsing customer tags:`, e);
        }
    }

    // 2. Get Cart subtotal and quantity
    const cartTotal = parseFloat(input.cart.cost.subtotalAmount.amount);
    const cartQty = input.cart.lines.reduce((acc, line) => acc + line.quantity, 0);
    console.error(`[B2B_PAYMENT_DEBUG] Subtotal: ${cartTotal} | Qty: ${cartQty} | Tags: ${JSON.stringify(customerTags)}`);

    // 3. Get Payment Rules from Shop Metafield
    const rulesStr = input.shop.metafield?.value;
    if (!rulesStr) {
        console.error(`[B2B_PAYMENT_DEBUG] No payment rules found in shop metafield.`);
        return EMPTY_RESULT;
    }

    let rules: any[] = [];
    try {
        rules = JSON.parse(rulesStr);
    } catch (e) {
        console.error(`[B2B_PAYMENT_DEBUG] Error parsing payment rules:`, e);
        return EMPTY_RESULT;
    }

    const operations: any[] = [];

    // 4. Evaluate Rules
    rules.forEach(rule => {
        if (rule.status !== "active") return;

        // Check if rule applies to this customer
        const ruleTag = rule.customerTag || "ALL";
        if (!customerTags.includes(ruleTag)) return;

        // Evaluate conditions
        let conditions = [];
        try {
            conditions = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions;
        } catch(e) {
            console.error(`[B2B_PAYMENT_DEBUG] Error parsing rule conditions:`, e);
        }

        const isMatch = rule.matchType === "ANY" 
            ? conditions.some((c: any) => evaluateCondition(c, cartTotal, cartQty, input))
            : conditions.every((c: any) => evaluateCondition(c, cartTotal, cartQty, input));

        if (isMatch) {
            console.error(`[B2B_PAYMENT_DEBUG] Match found! Applying rule: ${rule.name}`);
            input.paymentMethods.forEach(method => {
                const shouldHide = rule.targetMethods === "all_payment" || rule.targetMethods === "all"
                    ? true 
                    : rule.targetMethods?.split(",").map((s: string) => s.trim().toLowerCase()).includes(method.name.toLowerCase());

                if (shouldHide) {
                    operations.push({
                        hide: {
                            paymentMethodId: method.id
                        }
                    });
                }
            });
        }
    });

    return { operations };
}

function evaluateCondition(c: any, total: number, qty: number, input: RunInput): boolean {
    if (c.type === "total_amount") {
        return c.operator === "gte" ? total >= c.value : total <= c.value;
    }
    if (c.type === "total_qty") {
        return c.operator === "gte" ? qty >= c.value : qty <= c.value;
    }
    if (c.type === "product_contains") {
        const cartProductIds = input.cart.lines.map(l => l.merchandise.__typename === "ProductVariant" ? l.merchandise.product.id : "");
        const targetIds = Array.isArray(c.value) ? c.value : [c.value];
        if (c.operator === "contains_at_least_one") {
            return targetIds.some((id: string) => cartProductIds.includes(id));
        }
        if (c.operator === "contains_all") {
            return targetIds.every((id: string) => cartProductIds.includes(id));
        }
    }
    return false;
}
