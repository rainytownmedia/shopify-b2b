import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
  BillingReplacementBehavior,
  DeliveryMethod,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { PLANS, PLAN_PRO, PLAN_UNLIMITED } from "./config/plans.config";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma) as any,
  distribution: AppDistribution.AppStore,
  billing: {
    [PLAN_PRO]: {
      lineItems: [{
        amount: PLANS[PLAN_PRO].price,
        currencyCode: 'USD',
        interval: BillingInterval.Every30Days,
      }],
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    },
    [PLAN_UNLIMITED]: {
      lineItems: [{
        amount: PLANS[PLAN_UNLIMITED].price,
        currencyCode: 'USD',
        interval: BillingInterval.Every30Days,
      }],
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    CUSTOMERS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/update",
    },
    CUSTOMERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/customers/update",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      shopify.registerWebhooks({ session });
      const before = await prisma.shop.findUnique({ where: { id: session.shop } });
      const reactivating = Boolean(before && !before.isActive);

      await prisma.shop.upsert({
        where: { id: session.shop },
        create: {
          id: session.shop,
          domain: session.shop,
          isActive: true,
          b2bTagMetafieldBackfilledAt: null,
        },
        update: {
          isActive: true,
          ...(reactivating ? { b2bTagMetafieldBackfilledAt: null } : {}),
        },
      });

      const after = await prisma.shop.findUnique({ where: { id: session.shop } });
      if (after && !after.b2bTagMetafieldBackfilledAt) {
        const { scheduleB2BTagMetafieldBackfill } = await import(
          "./utils/b2b-customer-tag-metafield.server"
        );
        scheduleB2BTagMetafieldBackfill(session);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
