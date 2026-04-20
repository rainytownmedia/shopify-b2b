import { authenticate } from "./app/shopify.server";

export async function checkCustomizations(request: Request) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query {
      deliveryCustomizations(first: 10) {
        edges {
          node {
            id
            title
            enabled
            functionId
          }
        }
      }
      paymentCustomizations(first: 10) {
        edges {
          node {
            id
            title
            enabled
            functionId
          }
        }
      }
    }
  `);

  const data: any = await response.json();
  return data;
}
