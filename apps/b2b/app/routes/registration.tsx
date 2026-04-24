import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { buildRegistrationProxyMarkup } from "../utils/registration-liquid.server";

/**
 * Storefront wholesale registration — same delivery model as `quick-order.tsx`:
 * loader returns `application/liquid` so Shopify renders the fragment inside the theme
 * (header/footer). No React client bundle on the storefront.
 *
 * Direct hits (e.g. dev without proxy query) get a minimal `text/html` document with the same markup.
 * @see https://shopify.dev/docs/apps/online-store/app-proxies#liquid-response
 */
function registrationFormActionUrl(request: Request): string {
   const u = new URL(request.url);
   return `${u.origin}${u.pathname}`;
}

/**
 * Use Liquid (theme header/footer) for real storefront proxy URLs.
 * After POST, `signature` is often absent on redirect — still treat storefront hosts + `/apps/` as Liquid.
 * Never send `application/liquid` from the app host (SHOPIFY_APP_URL) or dev tunnels (browsers mishandle it).
 */
function shouldReturnLiquid(url: URL): boolean {
   if (url.searchParams.has("signature")) return true;
   const h = url.hostname;
   const path = url.pathname;
   if (!path.includes("/apps/") || !url.searchParams.get("shop")) return false;
   if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      /\.trycloudflare\.com$/i.test(h) ||
      /\.(ngrok-free\.app|ngrok\.io|ngrok\.app)$/i.test(h)
   ) {
      return false;
   }
   try {
      const appUrl = (process.env.SHOPIFY_APP_URL || "").trim();
      if (appUrl && h === new URL(appUrl).hostname) return false;
   } catch {
      /* ignore */
   }
   return true;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
   const url = new URL(request.url);
   let shop = url.searchParams.get("shop") || "";

   try {
      const { session } = await authenticate.public.appProxy(request);
      if (session) shop = session.shop;
   } catch (e) {
      console.log("App proxy auth info:", e);
   }

   if (!shop) {
      return new Response("Missing shop parameter", { status: 400 });
   }

   const formId = url.searchParams.get("id");
   const form = formId
      ? await db.registrationForm.findUnique({ where: { id: formId } })
      : await db.registrationForm.findFirst({ where: { shopId: shop } });

   if (!form) {
      const msg = `<div style="padding:2rem 1.25rem;"><p>We could not find a registration form for this store.</p></div>`;
      if (shouldReturnLiquid(url)) {
         return new Response(msg, { status: 200, headers: { "Content-Type": "application/liquid" } });
      }
      return new Response(
         `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Form not found</title></head><body>${msg}</body></html>`,
         { status: 200, headers: { "Content-Type": "text/html" } }
      );
   }

   const fields = JSON.parse(form.fields);
   const thankYou = url.searchParams.get("thank_you") === "1";
   const errRaw = url.searchParams.get("error");
   const errorMessage = errRaw ? decodeURIComponent(errRaw.replace(/\+/g, " ")) : undefined;

   const markup = buildRegistrationProxyMarkup({
      formName: form.name,
      fields,
      shop,
      formId: form.id,
      actionUrl: registrationFormActionUrl(request),
      thankYou,
      thankYouMessage: "Thank you! Your registration has been submitted for approval.",
      errorMessage
   });

   if (shouldReturnLiquid(url)) {
      return new Response(markup, {
         status: 200,
         headers: {
            "Content-Type": "application/liquid",
            "Cache-Control": "private, no-store"
         }
      });
   }

   return new Response(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${form.name.replace(
         /</g,
         ""
      )}</title></head><body style="margin:0;background:#f6f6f7;font-family:system-ui,sans-serif">${markup}</body></html>`,
      { status: 200, headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" } }
   );
};

export const action = async ({ request }: ActionFunctionArgs) => {
   const clonedRequest = request.clone();
   const formDataCopy = await clonedRequest.formData();
   let shop = (formDataCopy.get("shop") as string) || (formDataCopy.get("shop_domain") as string);

   if (!shop) {
      const url = new URL(request.url);
      shop = url.searchParams.get("shop") || "";
   }

   try {
      await authenticate.public.appProxy(request);
   } catch (e) {
      console.log("App proxy auth info:", e);
   }

   const redirectBack = () => {
      const u = new URL(request.url);
      u.searchParams.delete("thank_you");
      u.searchParams.delete("error");
      return u;
   };

   const formData = await request.formData();
   const formIdStr = formData.get("formId") as string;
   const emailField = formData.get("email") as string;

   const data: Record<string, unknown> = {};
   formData.forEach((value, key) => {
      if (key === "shop" || key === "formId") return;
      if (key.endsWith("[]")) {
         const base = key.slice(0, -2);
         if (!Array.isArray(data[base])) data[base] = [];
         data[base].push(value);
      } else {
         data[key] = value;
      }
   });

   try {
      await db.formSubmission.create({
         data: {
            shopId: shop,
            formId: formIdStr || "unknown",
            customerEmail: emailField || "no-email",
            formData: JSON.stringify(data),
            status: "pending"
         }
      });

      try {
         const store = await db.shop.findUnique({ where: { id: shop } });
         const adminEmail = store?.email || "admin@" + shop;

         const customerFirstName = data.first_name || data.firstName || data.fst || data.fname || "";
         const customerLastName = data.last_name || data.lastName || data.lst || data.lname || "";

         const emailData = {
            customerFirstName,
            customerLastName,
            customerEmail: emailField || "",
            shopName: store?.name || shop,
            customerStatus: "Pending"
         };

         import("../services/mailer.server").then(({ sendEmailTemplate }) => {
            if (adminEmail) {
               sendEmailTemplate({ shopId: shop, type: "ADMIN_NEW_APP", to: adminEmail, data: emailData });
            }
            if (emailField) {
               sendEmailTemplate({ shopId: shop, type: "CUSTOMER_PENDING", to: emailField, data: emailData });
            }
         }).catch(console.error);
      } catch (e) {
         console.error("Failed to enqueue notification emails", e);
      }

      const ok = redirectBack();
      ok.searchParams.set("thank_you", "1");
      return redirect(ok.toString());
   } catch (error: unknown) {
      const bad = redirectBack();
      const msg = error instanceof Error ? error.message : "Submission failed";
      bad.searchParams.set("error", encodeURIComponent(msg));
      return redirect(bad.toString());
   }
};
