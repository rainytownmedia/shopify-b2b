import type { Session } from "@shopify/shopify-api";
import shopify from "../shopify.server";
import db from "../db.server";

const B2B_TAGS_NAMESPACE = "b2b_app";
const B2B_TAGS_KEY = "b2b_tags";
const PAGE_SIZE = 50;
const METAFIELD_SET_CHUNK = 25;

const CUSTOMERS_PAGE = `#graphql
  query B2BBackfillCustomerTags($first: Int!, $after: String) {
    customers(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          tags
        }
      }
    }
  }`;

const METAFIELDS_SET = `#graphql
  mutation B2BBackfillMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Writes b2b_app / b2b_tags JSON for every customer, paginated, so checkout Functions can read tag context.
 * Run once per shop (after install or reinstall); customer updates continue via webhooks.
 */
export async function backfillB2BTagMetafieldsForShop(session: Session): Promise<{ totalCustomers: number }> {
  const client = new shopify.clients.Graphql({ session: session as any });
  let cursor: string | null = null;
  let hasNextPage = true;
  let total = 0;

  while (hasNextPage) {
    const res = (await client.request(CUSTOMERS_PAGE, {
      variables: { first: PAGE_SIZE, after: cursor },
    })) as { data?: { customers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: { id: string; tags: string[] } }> } } };
    const page = res.data?.customers;
    if (!page) {
      console.error(
        "[b2b_tag_metafield] missing customers in GraphQL response; aborting backfill (check API shape)"
      );
      break;
    }

    const { pageInfo, edges } = page;
    const metafields = edges.map((e) => ({
      ownerId: e.node.id,
      namespace: B2B_TAGS_NAMESPACE,
      key: B2B_TAGS_KEY,
      type: "json" as const,
      value: JSON.stringify(e.node.tags || []),
    }));

    for (let i = 0; i < metafields.length; i += METAFIELD_SET_CHUNK) {
      const part = metafields.slice(i, i + METAFIELD_SET_CHUNK);
      if (part.length === 0) {
        continue;
      }
      const mut = (await client.request(METAFIELDS_SET, { variables: { metafields: part } })) as {
        data?: { metafieldsSet?: { userErrors: Array<{ message: string; field: string[] | null }> } };
      };
      const uerr = mut.data?.metafieldsSet?.userErrors;
      if (uerr && uerr.length > 0) {
        const msg = uerr.map((e) => e.message).join("; ");
        throw new Error(`metafieldsSet: ${msg}`);
      }
    }

    total += edges.length;
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return { totalCustomers: total };
}

/**
 * Fires a full backfill in the background (non-blocking for OAuth) and sets Shop.b2bTagMetafieldBackfilledAt on success.
 */
export function scheduleB2BTagMetafieldBackfill(
  session: Session
): void {
  const shop = session.shop;
  void (async () => {
    try {
      const result = await backfillB2BTagMetafieldsForShop(session);
      await db.shop.update({
        where: { id: shop },
        data: { b2bTagMetafieldBackfilledAt: new Date() },
      });
      console.log(
        `[b2b_tag_metafield] backfill completed for ${shop} (${result.totalCustomers} customers)`
      );
    } catch (e) {
      console.error(`[b2b_tag_metafield] backfill failed for ${shop}:`, e);
    }
  })();
}
