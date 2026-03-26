import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop") || "";

  // Optionally verify signature
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session) shop = session.shop;
  } catch (e) {
    console.log("App proxy auth info:", e);
  }

  if (!shop) {
    return new Response("Missing shop parameter.", { status: 200, headers: { "Content-Type": "text/html" } });
  }

  const form = await db.registrationForm.findFirst({
    where: { shopId: shop }
  });

  if (!form) {
    return new Response(
      `<html><body><h2>App Proxy Connected!</h2><p>Wait, I didn't find a form in the database for shop: <b>${shop}</b>.</p><p>Please go to the Shopify Admin -> App -> B2B Customers & Onboarding and click "Save Form".</p></body></html>`, 
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  return { 
    view: "registration",
    id: form.id,
    formName: form.name, 
    fields: JSON.parse(form.fields),
    shop 
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const clonedRequest = request.clone();
  const formDataCopy = await clonedRequest.formData();
  let shop = formDataCopy.get("shop") as string;

  try {
    await authenticate.public.appProxy(request);
  } catch (e) {
    console.log("App proxy auth info:", e);
  }

  const formData = await request.formData();
  const formIdStr = formData.get("formId") as string;
  const emailField = formData.get("email") as string;

  const data: Record<string, any> = {};
  formData.forEach((value, key) => {
    if (key !== "shop" && key !== "formId") {
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
       const adminEmail = store?.email || ("admin@" + shop);
       
       // Identify simple first/last name values implicitly
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

     return { success: true, message: "Thank you! Your registration has been submitted for approval." };
  } catch (error: any) {
     return { success: false, error: error.message };
  }
};

export default function RegistrationFormPage() {
  const { formName, fields, shop, id } = useLoaderData<any>();
  const actionData = useActionData<any>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  const successMessage = actionData?.success ? actionData.message : null;
  const error = actionData?.error;

  if (actionData?.success) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: "center", padding: "40px" }}>
            <div style={{ fontSize: "4em", marginBottom: "20px" }}>✅</div>
            <h1 style={{ fontSize: "1.8em", color: "#202223", marginBottom: "15px" }}>Application Received</h1>
            <p style={{ color: "#6d7175", fontSize: "1.1em", lineHeight: "1.6" }}>
              {successMessage}
            </p>
            <a 
              href={`https://${shop}`}
              style={{ ...submitButtonStyle, display: "inline-block", textDecoration: "none", boxSizing: "border-box" }}
            >
              Back to Store
            </a>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div style={containerStyle}>
      <style>{`
        body { margin: 0; background: #f6f6f7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .input-focus:focus { border-color: #008060 !important; outline: none; box-shadow: 0 0 0 2px rgba(0, 128, 96, 0.1); }
      `}</style>
      
      <div style={cardStyle}>
        <div style={{ borderBottom: "1px solid #e1e1e1", paddingBottom: "20px", marginBottom: "30px" }}>
          <h1 style={{ margin: 0, fontSize: "1.6em", color: "#202223" }}>{formName}</h1>
          <p style={{ color: "#6d7175", margin: "10px 0 0", fontSize: "0.95em" }}>Please provide your business details below.</p>
        </div>

        {error && (
          <div style={{ background: "#fff4f4", border: "1px solid #ffcece", color: "#c10000", padding: "12px", borderRadius: "8px", marginBottom: "20px", fontSize: "0.9em" }}>
            ⚠️ {error}
          </div>
        )}

        <Form method="post" action="/apps/b2b-proxy/registration">
          <input type="hidden" name="shop" value={shop} />
          <input type="hidden" name="formId" value={id} />
          
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {fields.map((field: any) => (
              <div key={field.id}>
                <label style={labelStyle}>
                  {field.label} {field.required && <span style={{ color: "#d72c0d" }}>*</span>}
                </label>
                
                {field.type === "textarea" ? (
                  <textarea
                    name={field.label.toLowerCase().replace(/\s+/g, '_')}
                    required={field.required}
                    className="input-focus"
                    style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }}
                  />
                ) : field.type === "dropdown" ? (
                    <select
                        name={field.label.toLowerCase().replace(/\s+/g, '_')}
                        required={field.required}
                        className="input-focus"
                        style={inputStyle}
                    >
                        <option value="">Select an option...</option>
                    </select>
                ) : (
                  <input
                    type={field.type}
                    name={field.id === "eml" ? "email" : field.label.toLowerCase().replace(/\s+/g, '_')}
                    required={field.required}
                    className="input-focus"
                    style={inputStyle}
                  />
                )}
              </div>
            ))}

            <div style={{ marginTop: "10px" }}>
              <button 
                type="submit" 
                disabled={isSubmitting}
                style={{ 
                  ...submitButtonStyle, 
                  opacity: isSubmitting ? 0.7 : 1,
                  cursor: isSubmitting ? "not-allowed" : "pointer"
                }}
              >
                {isSubmitting ? "Submitting Application..." : "Submit Registration"}
              </button>
            </div>
            
            <p style={{ textAlign: "center", fontSize: "0.85em", color: "#8c9196" }}>
              Already have an account? <a href={`https://${shop}/account/login`} style={{ color: "#008060", textDecoration: "none" }}>Log in here</a>
            </p>
          </div>
        </Form>
      </div>
    </div>
  );
}

// --- STYLES ---
const containerStyle: React.CSSProperties = { maxWidth: "600px", margin: "60px auto", padding: "0 20px" };
const cardStyle: React.CSSProperties = { background: "white", padding: "40px", borderRadius: "16px", boxShadow: "0 10px 30px rgba(0,0,0,0.05)", border: "1px solid #e1e1e1" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.9em", fontWeight: "600", color: "#202223", marginBottom: "8px" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 16px", borderRadius: "8px", border: "1px solid #d1d1d1", fontSize: "1em", boxSizing: "border-box", transition: "all 0.2s" };
const submitButtonStyle: React.CSSProperties = { width: "100%", background: "#008060", color: "white", border: "none", padding: "14px 20px", borderRadius: "8px", fontSize: "1.1em", fontWeight: "bold", transition: "background 0.2s" };
