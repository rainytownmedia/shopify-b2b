
export const PLAN_FREE = "Free";
export const PLAN_PRO = "Pro";
export const PLAN_UNLIMITED = "Unlimited";

export interface PlanConfig {
  name: string;
  price: number;
  maxRowLimit: number;
  displayGbLimit: number;
  description: string;
  features: string[];
}

// Conversion rate: 1 GB = 100 Rules
const RULES_PER_GB = 100;

export const PLANS: Record<string, PlanConfig> = {
  [PLAN_FREE]: {
    name: "Free",
    price: 0,
    displayGbLimit: 5.0,
    maxRowLimit: 5.0 * RULES_PER_GB, // = 500
    description: "Everything you need to launch a B2B wholesale portal.",
    features: [
      "Up to 5 GB storage",
      "Customer Registration Form",
      "Wholesale Offers",
      "Tier Pricing"
    ]
  },
  [PLAN_PRO]: {
    name: "Pro",
    price: 20,
    displayGbLimit: 10.0,
    maxRowLimit: 10.0 * RULES_PER_GB, // = 1000
    description: "Double the storage for growing B2B businesses.",
    features: [
      "Up to 10 GB storage",
      "All Free Plan features",
      "Priority Support",
      "Advanced Analytics"
    ]
  },
  [PLAN_UNLIMITED]: {
    name: "Unlimited",
    price: 50,
    displayGbLimit: 9999.0,
    maxRowLimit: 9999.0 * RULES_PER_GB, // Very large, infinitely compatible
    description: "Infinite scaling for enterprise merchants with massive catalogs.",
    features: [
      "Unlimited storage",
      "All Pro Plan features",
      "Premium SLA Support",
      "Custom Setup Assistance"
    ]
  }
};
