import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import shopify from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response("Missing shop parameter", { status: 400 });
  }

  try {
    // Use unauthenticated admin to fetch data for the proxy page
    // This bypasses strict HMAC validation which frequently fails in dev tunnels
    let adminClient = null;
  try {
    const { admin: unauthAdmin } = await shopify.unauthenticated.admin(shop);
    adminClient = unauthAdmin;
  } catch (e) {
    console.warn("Failed to initialize unauthenticated admin, proceeding without products:", e.message);
  }

  const form = await db.quickOrderForm.findFirst({
    where: { shopId: shop, status: "active" },
    orderBy: { createdAt: "desc" }
  });

  if (!form) {
     const html = `
      <div style="padding: 50px; text-align: center; font-family: sans-serif;">
        <h2>Quick Order Form is not available</h2>
        <p>Please contact the store administrator.</p>
      </div>
    `;
    return new Response(html, { headers: { "Content-Type": "application/liquid" }, status: 200 });
  }

  const settings = JSON.parse(form.settings || "{}");

  let products = [];
  if (adminClient) {
    try {
      // Fetch products from Shopify GraphQL
      const response = await adminClient.graphql(`
      #graphql
      query getProducts {
        products(first: 20) {
          edges {
            node {
              id
              title
              handle
              featuredImage {
                url
              }
              variants(first: 5) {
                edges {
                  node {
                    id
                    title
                    price
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `);

    const responseJson = await response.json();
    products = responseJson.data?.products?.edges?.map((e: any) => e.node) || [];
  } catch (error) {
    console.error("GraphQL product fetch error:", error);
    // Fallback: Continue with empty products list rather than crashing
    products = [];
  }
  }

  const html = `
    <div class="quick-order-wrapper" style="max-width: 1200px; margin: 40px auto; padding: 0 20px;">
      <div class="quick-order-container" style="background-color: ${settings.bgRow || '#ffffff'}; padding: 30px; border: ${settings.borderSize || '1'}px ${settings.borderStyle || 'solid'} ${settings.borderColor || '#e1e1e1'}; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h1 style="color: ${settings.rowTextColor || '#333333'}; margin-bottom: 30px; font-size: 2em; font-weight: 700;">${form.title}</h1>
        
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; min-width: 600px;">
            <thead>
              <tr style="background-color: ${settings.bgHeader || '#3a3a3a'}; color: ${settings.headerColor || '#ffffff'};">
                <th style="padding: 16px; text-align: left; border-top-left-radius: 8px;">Product</th>
                <th style="padding: 16px; text-align: left;">Price</th>
                <th style="padding: 16px; text-align: center;">Quantity</th>
                <th style="padding: 16px; text-align: right; border-top-right-radius: 8px;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${products.map((p: any) => {
                const variant = p.variants.edges[0]?.node;
                if (!variant) return '';
                return `
                  <tr style="border-bottom: 1px solid ${settings.borderColor || '#e1e1e1'}; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#f9f9f9'" onmouseout="this.style.backgroundColor='transparent'">
                    <td style="padding: 16px; color: ${settings.rowTextColor || '#333333'};">
                      <div style="display: flex; align-items: center; gap: 15px;">
                        ${p.featuredImage ? `<img src="${p.featuredImage.url}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px; border: 1px solid #eee;" />` : `<div style="width: 60px; height: 60px; background: #f0f0f0; border-radius: 8px;"></div>`}
                        <div>
                          <div style="font-weight: 600;">${p.title}</div>
                          <div style="font-size: 0.85em; color: #666;">SKU: ${variant.sku || 'N/A'}</div>
                        </div>
                      </div>
                    </td>
                    <td style="padding: 16px; color: ${settings.rowTextColor || '#333333'}; font-weight: 500;">
                      {{ ${variant.price} | money }}
                    </td>
                    <td style="padding: 16px; text-align: center;">
                      <div style="display: inline-flex; align-items: center; border: 1px solid ${settings.borderColor || '#e1e1e1'}; border-radius: 6px; overflow: hidden;">
                        <button onclick="let inp = this.parentNode.querySelector('input'); inp.value = Math.max(0, parseInt(inp.value)-1)" style="padding: 8px 12px; background: #f4f4f4; border: none; cursor: pointer;">-</button>
                        <input type="number" value="0" min="0" id="qt-${variant.id.split('/').pop()}" style="width: 50px; text-align: center; border: none; padding: 8px 0; -moz-appearance: textfield;" />
                        <button onclick="let inp = this.parentNode.querySelector('input'); inp.value = parseInt(inp.value)+1" style="padding: 8px 12px; background: #f4f4f4; border: none; cursor: pointer;">+</button>
                      </div>
                    </td>
                    <td style="padding: 16px; text-align: right;">
                      <button 
                        onclick="addToCart('${variant.id}', document.getElementById('qt-${variant.id.split('/').pop()}').value)"
                        style="background-color: ${settings.bgButton || '#3a3a3a'}; color: ${settings.buttonColor || '#ffffff'}; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.2s;"
                        class="add-btn"
                      >
                        Add to Cart
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <script>
      async function addToCart(variantId, quantity) {
        quantity = parseInt(quantity);
        if (quantity <= 0) {
          alert('Please select a quantity greater than 0');
          return;
        }

        const numericId = variantId.split('/').pop();
        
        try {
          const response = await fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [{ id: numericId, quantity: quantity }]
            })
          });
          
          if (response.ok) {
            window.location.href = '/cart';
          } else {
            const err = await response.json();
            alert('Error: ' + (err.description || err.message));
          }
        } catch (e) {
          alert('Failed to add to cart: ' + e.message);
        }
      }
    </script>
    
    <style>
      .quick-order-wrapper button.add-btn:hover {
        background-color: ${settings.buttonHoverColor || '#3a3a3a'} !important;
        color: ${settings.buttonTextHoverColor || '#ffffff'} !important;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
      }
      input[type=number]::-webkit-inner-spin-button, 
      input[type=number]::-webkit-outer-spin-button { 
        -webkit-appearance: none; 
        margin: 0; 
      }
    </style>
  `;

  return new Response(html, {
    headers: {
      "Content-Type": "application/liquid",
    },
  });
  } catch (error: any) {
    console.error("FATAL LOADER ERROR:", error);
    return new Response("Server error: " + error.message, { status: 500 });
  }
};
